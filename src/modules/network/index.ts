// 网络监控模块：fetch / XHR 包装采集（规格书 7.3）。
// 静态资源由错误监控 capture 通道负责，本模块不碰静态资源，禁止用 URL 前缀规则区分。
import type { MonitorModule, ModuleContext } from '../../contracts/emitter'
import { defineModule } from '../../contracts/emitter'
import type { LogType, NetworkData } from '../../contracts/log'
import { matchesBlacklist } from '../../utils/rules'
import { wrapFetch } from './fetch'
import { wrapXhr } from './xhr'

/**
 * 网络监控模块。
 */
export class NetworkMonitor implements MonitorModule {
  readonly name: LogType = 'network'

  private ctx: ModuleContext | null = null
  private unWraps: Array<() => void> = []

  start(ctx: ModuleContext): void {
    if (this.ctx) return
    this.ctx = ctx

    const opts = {
      onDone: (data: NetworkData): void => {
        if (this.ctx) {
          this.ctx.emitter.emit('network', data)
        }
      },
      isBlacklisted: (url: string): boolean =>
        this.ctx ? this.ctx.config.urlBlacklist.some((item) => url.includes(item)) : true
    }
    this.unWraps.push(wrapFetch(opts))
    this.unWraps.push(wrapXhr(opts))
    // SPEC-GAP: collectResourceTiming 默认 false，本期不从 PerformanceObserver 的
    // resource 条目补 DNS/connect/TTFB（无关联 ID 会错配，见规格书 7.3 公共规则理由）。
  }

  stop(): void {
    for (const fn of this.unWraps) {
      fn()
    }
    this.unWraps = []
    this.ctx = null
  }
}

/**
 * 创建网络监控模块。
 */
export function createNetworkMonitor(): MonitorModule {
  return new NetworkMonitor()
}

/** 网络模块自描述：生命周期 + 黑名单过滤 + reqStartTime 作为事件起点。 */
export const networkModule = defineModule({
  type: 'network',
  create: createNetworkMonitor,
  filter: (data, config) => matchesBlacklist(data.reqUrl, config.urlBlacklist),
  startTimeOf: (data) => data.reqStartTime
})