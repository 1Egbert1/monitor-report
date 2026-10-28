// 默认配置（见规格书 5.1）与其他常量（见规格书 5.3）。
import type { ModuleType, ResolvedModuleConfig } from '../contracts/config'
import type { LogLevel, LogType } from '../contracts/log'

/** 默认模块开关：网络与内存默认关闭（噪音与兼容性考虑）。 */
const DEFAULT_MODULES: ModuleType[] = ['error', 'performance']

/**
 * 各模块默认配置：模块专属配置的唯一默认值来源。
 * 合并逻辑按此对象的键遍历，新增模块无需改 core/config.ts。
 */
export const MODULE_DEFAULTS: Readonly<ResolvedModuleConfig> = Object.freeze({
  error: Object.freeze({}),
  performance: Object.freeze({ clsReportThreshold: 0, fpsEnabled: false, fpsSampleDurationMs: 10000 }),
  network: Object.freeze({ collectResourceTiming: false }),
  memory: Object.freeze({
    interval: 30000,
    reportOnlyOnGrowth: true,
    growthThresholdPerMinute: 3145728
  })
}) as Readonly<ResolvedModuleConfig>

/** 全部模块类型（由 MODULE_DEFAULTS 的键推导，不再单独维护列表）。 */
export const MODULE_TYPES = Object.freeze(
  Object.keys(MODULE_DEFAULTS) as ModuleType[]
) as readonly ModuleType[]

/** 默认采样率：全量。 */
const DEFAULT_SAMPLE = Object.freeze(
  Object.fromEntries(MODULE_TYPES.map((type) => [type, 1]))
) as Readonly<Record<ModuleType, number>>

/** 默认配置对象（深层只读）。 */
export const DEFAULTS = Object.freeze({
  env: 'production',
  modules: Object.freeze(DEFAULT_MODULES),
  sample: DEFAULT_SAMPLE,
  debounceTime: 1000,
  maxLogsPerPage: 300,
  lazyReport: false,
  urlBlacklist: Object.freeze([]) as readonly string[],
  ignoreErrors: Object.freeze([]) as readonly (string | RegExp)[],
  dedupWindow: 5000,
  maskQueryKeys: Object.freeze([]) as readonly string[],
  reportPerformanceOnHiddenOnly: true,
  // 行为栈容量：Sentry 默认 100，这里取 20 —— 受 keepalive / sendBeacon 60KB 上限约束
  maxBreadcrumbs: 20,
  // console 只记 warn 及以上：log/info/debug 量大且隐私风险高
  consoleBreadcrumb: 'warn' as const,
  // 上报方式：fetch 有回执可重试；image 是 GET 像素信标（跨域免配置但无回执）
  transport: 'fetch' as const,
  requestConfig: Object.freeze({ headers: Object.freeze({}), timeout: 10000 }),
  debug: false
} as const)

/** 错误去重表条目上限，超出按 LRU 淘汰。 */
export const DEDUP_MAP_MAX = 200

/**
 * 各日志类型的默认严重级别：模块未声明 levelOf 时的兜底。
 * 语义对齐 Sentry 的 event level（fatal/error/warning/info/debug）。
 */
export const DEFAULT_LEVEL_BY_TYPE: Readonly<Record<LogType, LogLevel>> = Object.freeze({
  error: 'error',
  performance: 'info',
  network: 'info',
  memory: 'info',
  custom: 'info'
})

/** 堆栈截断帧数。 */
export const STACK_MAX_FRAMES = 10

/** keepalive / sendBeacon 体积上限（官方 64KB，留余量）。 */
export const BEACON_MAX_BYTES = 60000

/**
 * image 信标模式的 URL 长度上限（保守取 2000 字节）。
 * 浏览器本身可到 8KB，但中间代理常见 2–4KB 截断；超长会导致服务端解析失败且无感知。
 */
export const IMAGE_MAX_URL_BYTES = 2000

/** 本期不采集请求体内容（隐私）。 */
export const XHR_BODY_PREVIEW_MAX = 0

/** 长驻页面性能终值兜底上报间隔。 */
export const PERF_REPORT_FALLBACK_MS = 60000