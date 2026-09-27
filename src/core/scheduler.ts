// 上报调度（规格书 6.4）：防抖批报 + flush + 失败回塞 + 指数退避 + 卸载兜底。
import { debounce, type DebounceHandle } from '../utils/debounce'
import type { ReportQueue } from './queue'
import type { Transport } from './transport'
import type { RuntimeCounters } from './pipeline'

/** 指数退避间隔（ms）：1s / 2s / 4s，最多 3 次重试。 */
const RETRY_DELAYS = [1000, 2000, 4000] as const

/** 调度器依赖注入。 */
export interface SchedulerDeps {
  queue: ReportQueue
  transport: Transport
  counters: RuntimeCounters
  debounceTime: number
  /** 页面隐藏时的前置结算钩子（规格书 6.4 第①步：触发性能模块结算终值等）。 */
  onPageHidden?: () => void
}

/**
 * 批报调度器：负责防抖、flush、失败回塞与卸载链路。
 * 禁止使用 unload / beforeunload（见禁止事项 5），仅注册 visibilitychange 与 pagehide。
 */
export class Scheduler {
  private readonly handle: DebounceHandle
  private flushing = false
  private retries = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private disposed = false
  private offs: Array<() => void> = []

  constructor(private readonly deps: SchedulerDeps) {
    this.handle = debounce(() => {
      void this.flush(false)
    }, deps.debounceTime)

    const onHidden = (): void => {
      if (this.disposed) return
      // 规格书 6.4 隐藏链路：① 模块结算终值 ② 卸载通道 flush。
      this.deps.onPageHidden?.()
      this.flushUnload()
    }
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') {
        onHidden()
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pagehide', onHidden)
    this.offs.push(() => document.removeEventListener('visibilitychange', onVisibilityChange))
    this.offs.push(() => window.removeEventListener('pagehide', onHidden))
  }

  /**
   * 新日志入队后调用：启动防抖时钟。
   */
  notifyAdded(): void {
    if (!this.disposed) {
      this.handle.schedule()
    }
  }

  /**
   * 手动立即上报（常规通道）。
   */
  flushReport(): void {
    if (this.disposed) return
    this.handle.cancel()
    void this.flush(false)
  }

  /**
   * 页面隐藏 / 卸载时立即上报（卸载通道），也用于 destroy 兜底。
   */
  flushUnload(): void {
    if (this.disposed) return
    this.handle.cancel()
    void this.flush(true)
  }

  /**
   * 解绑全部监听、取消定时器（destroy 清理链）。
   */
  dispose(): void {
    this.disposed = true
    this.handle.cancel()
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    for (const off of this.offs) {
      off()
    }
    this.offs = []
  }

  /**
   * 执行一次 flush：取空则返回；卸载通道失败回塞；
   * 常规通道失败回塞队首并指数退避重试，超限放弃并计入 failedCount。
   * @param unload 是否卸载通道
   */
  private async flush(unload: boolean): Promise<void> {
    if (this.disposed) return
    // 卸载通道不受 flushing 锁限制：常规请求在途时页面隐藏，仍须尽力补发剩余批次。
    if (!unload && this.flushing) return

    const logs = this.deps.queue.drainAll()
    if (logs.length === 0) return

    this.flushing = true
    try {
      if (unload) {
        const result = this.deps.transport.sendUnload(logs)
        if (result === 'dropped') {
          this.deps.counters.dropped++
          this.deps.queue.prepend(logs)
        }
      } else {
        const ok = await this.deps.transport.send(logs)
        if (ok) {
          this.retries = 0
        } else {
          this.deps.queue.prepend(logs)
          this.scheduleRetry()
        }
      }
    } catch {
      if (!unload) {
        this.deps.queue.prepend(logs)
        this.scheduleRetry()
      }
    } finally {
      this.flushing = false
    }
  }

  /**
   * 指数退避重试；超过 3 次放弃并计入 failedCount（日志留在队列中随下次批次自然发送）。
   */
  private scheduleRetry(): void {
    if (this.retries >= RETRY_DELAYS.length) {
      this.deps.counters.failed++
      this.retries = 0
      return
    }
    const delay = RETRY_DELAYS[this.retries] ?? 4000
    this.retries++
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.flush(false)
    }, delay)
  }
}