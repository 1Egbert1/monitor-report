// 默认配置（见规格书 5.1）与其他常量（见规格书 5.3）。
import type { ModuleType } from '../contracts/config'

/** 默认模块开关：网络与内存默认关闭（噪音与兼容性考虑）。 */
const DEFAULT_MODULES: ModuleType[] = ['error', 'performance']

/** 默认采样率：全量。 */
const DEFAULT_SAMPLE: Record<ModuleType, number> = {
  error: 1,
  performance: 1,
  network: 1,
  memory: 1
}

/** 默认配置对象（深层只读）。 */
export const DEFAULTS = Object.freeze({
  env: 'production',
  modules: Object.freeze(DEFAULT_MODULES),
  sample: Object.freeze(DEFAULT_SAMPLE),
  debounceTime: 1000,
  maxLogsPerPage: 300,
  lazyReport: false,
  urlBlacklist: Object.freeze([]),
  ignoreErrors: Object.freeze([]),
  dedupWindow: 5000,
  maskQueryKeys: Object.freeze([]),
  reportPerformanceOnHiddenOnly: true,
  requestConfig: Object.freeze({ headers: Object.freeze({}), timeout: 10000 }),
  performance: Object.freeze({ clsReportThreshold: 0 }),
  network: Object.freeze({ collectResourceTiming: false }),
  memory: Object.freeze({
    interval: 30000,
    reportOnlyOnGrowth: true,
    growthThresholdPerMinute: 3145728
  }),
  debug: false
} as const)

/** 错误去重表条目上限，超出按 LRU 淘汰。 */
export const DEDUP_MAP_MAX = 200

/** 堆栈截断帧数。 */
export const STACK_MAX_FRAMES = 10

/** keepalive / sendBeacon 体积上限（官方 64KB，留余量）。 */
export const BEACON_MAX_BYTES = 60000

/** 本期不采集请求体内容（隐私）。 */
export const XHR_BODY_PREVIEW_MAX = 0

/** 长驻页面性能终值兜底上报间隔。 */
export const PERF_REPORT_FALLBACK_MS = 60000