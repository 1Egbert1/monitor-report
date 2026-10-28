// 传输层（规格书 6.5）：fetch + keepalive / sendBeacon 降级；上报体顶层结构固定。
import type { ResolvedConfig } from '../contracts/config'
import type { ReportLog, ReportPayload } from '../contracts/log'
import { BEACON_MAX_BYTES, IMAGE_MAX_URL_BYTES } from '../constants/defaults'
import { schemaVersion, sdkVersion } from '../constants/version'
import type { RuntimeCounters } from './pipeline'

/** 卸载上报结果。 */
export type UnloadSendResult = 'sent' | 'dropped'

/** 一批日志共享的信息（不含 appInfo——它从 config 取，和 sentAt/schemaVersion 同属组装层）。 */
type SharedReportInfo = Omit<ReportPayload, 'schemaVersion' | 'sentAt' | 'appInfo' | 'logs'>

/**
 * 传输层实现。
 */
export class Transport {
  /** 当前常规请求的 AbortController（destroy 时 abort）。 */
  private controller: AbortController | null = null

  /**
   * @param config 解析后配置
   * @param counters 运行时计数器（dropped 由本层累加）
   * @param getSharedInfo 整批共享信息（deviceInfo / pageInfo / sessionInfo / tags / extra）
   */
  constructor(
    private readonly config: ResolvedConfig,
    private readonly counters: RuntimeCounters,
    private readonly getSharedInfo: () => SharedReportInfo
  ) {}

  /**
   * 常规上报：优先自定义 request（完全替换传输逻辑）；否则 fetch POST。
   * 成功返回 true，否则 false（由调度器决定重试）。
   * @param logs 批次日志
   */
  async send(logs: ReportLog[]): Promise<boolean> {
    const { config } = this
    if (config.request) {
      try {
        await config.request(logs)
        return true
      } catch {
        return false
      }
    }
    const reportUrl = config.reportUrl
    if (!reportUrl) return false

    // 像素信标模式：GET 直发，跨域无需服务端配 CORS；代价是读不到响应，只能乐观计为成功
    if (config.transport === 'image') {
      return this.sendByImage(reportUrl, logs)
    }

    this.controller = new AbortController()
    const timer =
      config.requestConfig.timeout > 0
        ? setTimeout(() => {
            this.controller?.abort()
          }, config.requestConfig.timeout)
        : null
    try {
      const res = await fetch(reportUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...config.requestConfig.headers },
        body: this.buildPayload(logs),
        signal: this.controller.signal
      })
      return res.ok
    } catch {
      return false
    } finally {
      if (timer !== null) {
        clearTimeout(timer)
      }
      this.controller = null
    }
  }

  /**
   * 卸载上报：≤ BEACON_MAX_BYTES 优先 fetch keepalive（可带自定义 header），
   * 否则 sendBeacon 降级（不带 header）；两者均不可用则跳过并计入 dropped。
   * @param logs 批次日志
   */
  sendUnload(logs: ReportLog[]): UnloadSendResult {
    const { config } = this
    if (config.unloadRequest) {
      config.unloadRequest(logs)
      return 'sent'
    }
    // 自定义 request 模式下未提供 unloadRequest：按规格跳过并计入 droppedCount。
    if (config.request) {
      this.counters.dropped++
      return 'dropped'
    }

    const reportUrl = config.reportUrl
    if (!reportUrl) {
      this.counters.dropped++
      return 'dropped'
    }
    const body = this.buildPayload(logs)

    if (typeof fetch === 'function' && new Blob([body]).size <= BEACON_MAX_BYTES) {
      try {
        void fetch(reportUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...config.requestConfig.headers },
          body,
          keepalive: true
        })
        return 'sent'
      } catch {
        // keepalive 发起失败时继续走 sendBeacon 降级
      }
    }
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const ok = navigator.sendBeacon(
        reportUrl,
        new Blob([body], { type: 'application/json' })
      )
      if (ok) return 'sent'
    }
    this.counters.dropped++
    return 'dropped'
  }

  /**
   * 中止进行中的常规请求（destroy 清理链）。
   */
  abort(): void {
    if (this.controller !== null) {
      this.controller.abort()
      this.controller = null
    }
  }

  /**
   * 构造上报体：顶层结构固定（appId/sdkVersion/schemaVersion/sentAt/pageUrl/samples）。
   * @param logs 批次日志
   */
  /**
   * 像素信标上报：`new Image()` 发 GET，跨域免服务端配置（no-cors）。
   * 代价是读不到响应，成功与否无法判定——只能乐观计为已发送，不重试。
   * @param reportUrl 上报地址
   * @param logs 批次日志
   */
  /**
   * 按「条」分批发送，而不是把整批塞进一个 GET。
   * 理由：URL 超长会被中间代理截断，截断后服务端解析必然失败且客户端无感知（no-cors 读不到响应）。
   * 按条拆的好处是**服务端无需任何重组协议**——每条请求都是一份完整数据。
   * @param reportUrl 上报地址
   * @param logs 批次日志
   */
  private sendByImage(reportUrl: string, logs: ReportLog[]): boolean {
    if (typeof Image === 'undefined') return false

    let sent = 0
    let dropped = 0
    let batch: ReportLog[] = []

    const flush = (): void => {
      if (batch.length === 0) return
      if (this.fireImageBeacon(reportUrl, batch)) {
        sent += batch.length
      } else {
        dropped += batch.length
      }
      batch = []
    }

    for (const log of logs) {
      if (this.imageUrlLength(reportUrl, [...batch, log]) <= IMAGE_MAX_URL_BYTES) {
        batch.push(log)
        continue
      }
      flush()
      // 单条仍超长：截断 stack 再试（stack 是可选字段，截断是降级，丢整条是归零）
      const trimmed = trimStack(log)
      if (this.imageUrlLength(reportUrl, [trimmed]) <= IMAGE_MAX_URL_BYTES) {
        batch.push(trimmed)
      } else {
        dropped++
      }
    }
    flush()

    if (dropped > 0) this.counters.dropped += dropped
    return sent > 0
  }

  /**
   * 算出该批次最终 URL 的字节长度（含 `?d=` 与 encodeURIComponent 的膨胀）。
   * @param reportUrl 上报地址
   * @param logs 批次日志
   */
  private imageUrlLength(reportUrl: string, logs: ReportLog[]): number {
    return reportUrl.length + 3 + encodeURIComponent(this.buildPayload(logs)).length
  }

  /**
   * 发一个 1×1 像素信标（no-cors GET，读不到响应）。
   * @param reportUrl 上报地址
   * @param logs 批次日志
   */
  private fireImageBeacon(reportUrl: string, logs: ReportLog[]): boolean {
    try {
      const query = encodeURIComponent(this.buildPayload(logs))
      const img = new Image()
      img.width = 1
      img.height = 1
      // 释放回调闭包，避免图片对象被长期持有
      img.onerror = (): void => {
        img.onload = null
        img.onerror = null
      }
      img.onload = img.onerror
      img.src = `${reportUrl}${reportUrl.includes('?') ? '&' : '?'}d=${query}`
      return true
    } catch {
      return false
    }
  }

  private buildPayload(logs: ReportLog[]): string {
    const { config } = this
    const payload: ReportPayload = {
      schemaVersion,
      sentAt: Date.now(),
      appInfo: {
        appId: config.appId,
        sdkVersion,
        env: config.env,
        release: config.release
      },
      ...this.getSharedInfo(),
      logs
    }
    // SPEC-GAP: 鉴权 token 取自 extra.token（string），随体传在顶层 token 字段，
    // 保证 sendBeacon 降级路径（无法携带自定义 header）也不会丢失鉴权信息。
    const token = config.extra['token']
    if (typeof token === 'string' && token !== '') {
      return JSON.stringify({ ...payload, token })
    }
    return JSON.stringify(payload)
  }
}
/** image 模式下单条日志超长时，stack 截断到该字符数。 */
const IMAGE_STACK_MAX_CHARS = 500

/**
 * 截断 stack，让单条日志能塞进 URL。
 * 只动可选字段，保留 type / message / level 等核心信息。
 * @param log 原始日志
 */
function trimStack(log: ReportLog): ReportLog {
  const data = log.data as { stack?: unknown }
  const stack = data.stack
  if (typeof stack !== 'string' || stack.length <= IMAGE_STACK_MAX_CHARS) return log
  // 在副本上改可选字段：ReportLog 是联合类型，直接 spread 收窄不了
  const copy: ReportLog = { ...log }
  const mutable = copy as { data: Record<string, unknown> }
  mutable.data = { ...data, stack: stack.slice(0, IMAGE_STACK_MAX_CHARS) }
  return copy
}
