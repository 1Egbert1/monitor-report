// 各指标 Observer 配置表（规格书 7.2）：全部 buffered: true（禁止事项 3，漏掉即指标永久丢失）。
import type { PerformanceData } from '../../contracts/log'

/** event 观察器配置（lib.dom 未含 durationThreshold，需扩展）。 */
export type PerfObserverInit = PerformanceObserverInit & { durationThreshold?: number }

/** 指标 → Observer 配置。 */
export interface PerfObserverSpec {
  metricName: PerformanceData['metricName']
  entryType: string
  init: PerfObserverInit
}

/** 五指标配置表；SDK 晚加载也能取到 buffered 历史条目。 */
export const PERFORMANCE_OBSERVER_CONFIGS: ReadonlyArray<PerfObserverSpec> = [
  { metricName: 'FCP', entryType: 'paint', init: { type: 'paint', buffered: true } },
  {
    metricName: 'LCP',
    entryType: 'largest-contentful-paint',
    init: { type: 'largest-contentful-paint', buffered: true }
  },
  { metricName: 'FID', entryType: 'first-input', init: { type: 'first-input', buffered: true } },
  {
    metricName: 'INP',
    entryType: 'event',
    init: { type: 'event', buffered: true, durationThreshold: 40 }
  },
  { metricName: 'CLS', entryType: 'layout-shift', init: { type: 'layout-shift', buffered: true } }
]