// 传输层（规格书 6.5）：fetch + keepalive / sendBeacon 降级；上报体顶层结构固定。
import type { ResolvedConfig } from '../contracts/config'
import type { ReportLog } from '../contracts/log'
import { BEACON_MAX_BYTES } from '../constants/defaults'
import { maskUrlQuery } from '../utils/mask'
import { schemaVersion, sdkVersion } from '../constants/version'
import type { RuntimeCounters } from './pipeline'

/** 卸载上报结果。 */
export type UnloadSendResult = 'sent' | 'dropped'

/**
 * 传输层实现。
 */
export class Transport {
  /** 当前常规请求的 AbortController（destroy 时 abort）。 */
  private controller: AbortController | null = null

  /**
   * @param config 解析后配置
   * @param counters 运行时计数器（dropped 由本层累加）
   * @param getPageUrl 上报体顶层 pageUrl 快照来源
   */
  constructor(
    private readonly config: ResolvedConfig,
    private readonly counters: RuntimeCounters,
    private readonly getPageUrl: () => string
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
  private buildPayload(logs: ReportLog[]): string {
    const { config } = this
    const payload: Record<string, unknown> = {
      appId: config.appId,
      sdkVersion,
      schemaVersion,
      sentAt: Date.now(),
      pageUrl: maskUrlQuery(this.getPageUrl(), config.maskQueryKeys),
      samples: logs
    }
    // SPEC-GAP: 鉴权 token 取自 extra.token（string），随体传在顶层 token 字段，
    // 保证 sendBeacon 降级路径（无法携带自定义 header）也不会丢失鉴权信息。
    const token = config.extra['token']
    if (typeof token === 'string' && token !== '') {
      payload.token = token
    }
    return JSON.stringify(payload)
  }
}