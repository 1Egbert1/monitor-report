// 核心主类：唯一状态持有者。配置合并、数据管道、上报调度、生命周期（规格书 6.6）。
import type { LogDataOf, LogType, CustomLog, ReportPayload } from '../contracts/log'
import type { UserConfig } from '../contracts/config'
import { maskUrlQuery, maskPiiText } from '../utils/mask'
import type { ModuleContext, ModuleRegistry, MonitorModule } from '../contracts/emitter'
import { behaviorsOf } from '../contracts/emitter'
import { isBrowser } from './env'
import { resolveConfig } from './config'
import { ReportQueue } from './queue'
import { Pipeline, buildLogBase, type QueuedRaw, type RuntimeCounters } from './pipeline'
import { Scheduler } from './scheduler'
import { Transport } from './transport'
import { unregisterSingleton } from './singleton'
import { getNavigationType, type NavigationType } from '../utils/time'
import type { ResolvedConfig } from '../contracts/config'

/** destroy() 选项。 */
export interface DestroyOptions {
  /** 销毁前是否 flush（默认 true）。 */
  flush?: boolean
}

/** 自诊断状态。 */
export interface MonitorStatus {
  queued: number
  dropped: number
  failed: number
  disabled: boolean
}

/**
 * 前端监控核心类：唯一状态持有者。
 * 非浏览器环境下位静默禁用（所有能力内部 no-op，不抛错、不产生上报）。
 */
export class LogReport {
  /** 环境降级标志：非浏览器环境为 true，所有公开方法立即返回。 */
  public readonly disabled: boolean

  private config!: ResolvedConfig
  private sessionId = ''
  private navigationType: NavigationType = 'unknown'
  private ua = ''
  private userId: string | undefined
  private traceId: string | undefined
  private tags: Record<string, string> = {}
  private extra: Record<string, unknown> = {}
  private queue!: ReportQueue
  private pipeline!: Pipeline
  private scheduler!: Scheduler
  private transport!: Transport
  private counters: RuntimeCounters = { sampledOut: 0, dropped: 0, failed: 0 }
  private rawQueue: QueuedRaw[] = []
  private startedModules: MonitorModule[] = []
  private teardownFns: Array<() => void> = []
  private destroyedFlag = false

  /**
   * @param userConfig 用户配置
   * @param registry 模块注册表（entries 层注入；core 不依赖具体模块）
   */
  constructor(userConfig: UserConfig, registry: ModuleRegistry = {}) {
    // 构造函数第一件事：环境守卫（规格书 6.1）。
    this.disabled = !isBrowser()
    if (this.disabled) {
      return
    }
    this.config = resolveConfig(userConfig)
    this.sessionId = genSessionId()
    this.navigationType = getNavigationType()
    this.ua = navigator.userAgent

    this.queue = new ReportQueue(this.config.maxLogsPerPage, (count) =>
      this.makeDroppedLog(count)
    )
    this.pipeline = new Pipeline({
      config: this.config,
      queue: this.queue,
      counters: this.counters,
      // 模块特化规则由注册表注入，核心不感知具体模块
      behaviors: behaviorsOf(registry),
      getCommon: () => ({
        userId: this.userId,
        traceId: this.traceId,
        tags: this.tags,
        extra: this.extra
      }),
      getPageSnapshot: () => pageSnapshot(),
      getNavigationType: () => this.navigationType,
      getUa: () => this.ua,
      getSessionId: () => this.sessionId,
      lazyPush: this.config.lazyReport ? (raw) => this.rawQueue.push(raw) : undefined
    })
    this.transport = new Transport(this.config, this.counters, () => this.buildSharedInfo())
    this.scheduler = new Scheduler({
      queue: this.queue,
      transport: this.transport,
      counters: this.counters,
      debounceTime: this.config.debounceTime,
      // 页面隐藏链第①步：首先让各模块结算终值（性能终态 / 错误聚合 flush），
      // 再在第②步由调度器 flush，保证结算产物进入同一次卸载批次。
      onPageHidden: () => {
        for (const mod of this.startedModules) {
          (mod as MonitorModule & { onPageHidden?: () => void }).onPageHidden?.()
        }
      }
    })
    this.startModules(registry)
  }

  /**
   * 手动上报一条日志，走完整管道。
   * @param type 日志类型
   * @param data 数据类型化数据
   */
  addReport<T extends LogType>(type: T, data: LogDataOf<T>): void {
    if (this.disabled || this.destroyedFlag) return
    this.pipeline.process(type, data)
    this.scheduler.notifyAdded()
  }

  /**
   * 合并 extra（与配置 extra 合并，后写入覆盖同名键）。
   * @param extra 附加数据
   */
  setExtra(extra: Record<string, unknown>): void {
    if (this.disabled || this.destroyedFlag) return
    this.extra = { ...this.extra, ...extra }
  }

  /**
   * 设置用户标识。
   * @param userId 用户 ID
   */
  setUser(userId: string): void {
    if (this.disabled || this.destroyedFlag) return
    this.userId = userId
  }

  /**
   * 设置单个 tag。
   * @param key tag 名
   * @param value tag 值
   */
  setTag(key: string, value: string): void {
    if (this.disabled || this.destroyedFlag) return
    this.tags = { ...this.tags, [key]: value }
  }

  /**
   * 设置链路 ID（透传字段）。
   * @param traceId 链路 ID
   */
  setTraceId(traceId: string): void {
    if (this.disabled || this.destroyedFlag) return
    this.traceId = traceId
  }

  /**
   * 退出延迟上报模式：把 reportQueue 缓存的原始数据重走完整管道。
   */
  startReport(): void {
    if (this.disabled || this.destroyedFlag) return
    const items = this.rawQueue
    this.rawQueue = []
    for (const item of items) {
      // 直接传原始对，避免按类型写 switch（新增模块无需改动此处）
      this.pipeline.process(item)
    }
    this.scheduler.notifyAdded()
  }

  /**
   * 立即上报一次（常规通道）。
   */
  flushReport(): void {
    if (this.disabled || this.destroyedFlag) return
    this.scheduler.flushReport()
  }

  /**
   * 销毁实例：先 flush（默认）再执行完整清理（监听 / Observer / 定时器 / 队列 / 单例槽位）。
   * @param opts flush 默认 true
   */
  destroy(opts?: DestroyOptions): void {
    if (this.disabled || this.destroyedFlag) return
    // SPEC-GAP: destroy 触发的最佳努力 flush 走卸载通道（keepalive），
    // 以保证随后的 AbortController.abort() 清理不会杀死这最后一批上报。
    if (opts?.flush !== false) {
      this.scheduler.flushUnload()
    }
    this.destroyedFlag = true
    for (const mod of this.startedModules) {
      try {
        mod.stop()
      } catch {
        // 模块停止异常不影响整体清理
      }
    }
    this.startedModules = []
    for (const fn of this.teardownFns) {
      try {
        fn()
      } catch {
        // 清理回调异常不影响整体清理
      }
    }
    this.teardownFns = []
    this.scheduler.dispose()
    this.transport.abort()
    this.queue.clear()
    this.rawQueue = []
    unregisterSingleton(this)
  }

  /**
   * 自诊断：返回队列深度、丢弃/失败计数与降级状态。
   */
  getStatus(): MonitorStatus {
    if (this.disabled) {
      return { queued: 0, dropped: 0, failed: 0, disabled: true }
    }
    return {
      queued: this.queue.size + this.rawQueue.length,
      dropped: this.counters.dropped + this.queue.droppedCount,
      failed: this.counters.failed,
      disabled: false
    }
  }

  /**
   * 启动配置中声明的模块。
   * @param registry 模块注册表
   */
  private startModules(registry: ModuleRegistry): void {
    for (const type of this.config.modules) {
      const descriptor = registry[type]
      if (!descriptor) continue
      const mod = descriptor.create()
      this.startedModules.push(mod)
      mod.start(this.createModuleContext())
    }
  }

  /**
   * 为模块构造运行上下文。
   */
  private createModuleContext(): ModuleContext {
    return {
      config: this.config,
      emitter: {
        emit: <T extends LogType>(type: T, data: LogDataOf<T>): void => {
          if (this.destroyedFlag) return
          this.pipeline.process(type, data)
          this.scheduler.notifyAdded()
        }
      },
      onTeardown: (fn: () => void) => {
        this.teardownFns.push(fn)
      },
      isPageHidden: () => document.visibilityState === 'hidden',
      now: () => Date.now()
    }
  }

  /**
   * 构造一批日志共享的信息：设备 / 页面 / 会话 + 宿主自定义标签与数据。
   * 这些字段整批只存一份，不在每条日志上重复。
   */
  private buildSharedInfo(): Omit<
    ReportPayload,
    'schemaVersion' | 'sentAt' | 'appInfo' | 'logs'
  > {
    const page = pageSnapshot()
    return {
      deviceInfo: { ua: this.ua },
      pageInfo: {
        url: maskUrlQuery(page.url, this.config.maskQueryKeys),
        path: maskPiiText(page.path),
        navigationType: this.navigationType
      },
      sessionInfo: {
        sessionId: this.sessionId,
        userId: this.userId,
        traceId: this.traceId
      },
      tags: { ...this.config.tags, ...this.tags },
      extra: { ...this.config.extra, ...this.extra }
    }
  }

  /**
   * 构造 logs_dropped 通知（custom 类型，附加到批次末尾）。
   * @param count 被丢弃条数
   */
  private makeDroppedLog(count: number): CustomLog {
    return {
      ...buildLogBase(),
      type: 'custom',
      // 队列丢弃属需要关注的信号，固定 warning（不受 custom 默认 info 影响）
      level: 'warning',
      data: { event: 'logs_dropped', count }
    }
  }
}

/**
 * 读取当前页面快照（函数内部访问 location，保持无顶层副作用）。
 */
function pageSnapshot(): { url: string; path: string } {
  return {
    url: location.href,
    path: location.pathname + location.hash
  }
}

/**
 * 生成 sessionId：Math.random 拼接（禁止事项 18：不得引入 crypto 依赖）。
 */
function genSessionId(): string {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
}