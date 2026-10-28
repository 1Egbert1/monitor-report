// 契约层：配置类型（纯类型，零逻辑）。
import type { LogType, ReportLog } from './log'

/** 模块类型（可枚举的采集维度）：日志类型去掉 custom（自定义上报无对应模块）。 */
export type ModuleType = Exclude<LogType, 'custom'>

/**
 * 各模块专属配置的唯一声明点（解析后的形态，字段全部有值）。
 * 新增模块：在此加一条映射，UserConfig / ResolvedConfig / 合并逻辑同时生效。
 */
export interface ModuleConfigMap {
  error: Record<string, never>
  performance: {
    clsReportThreshold: number
    /** 是否采集 FPS（默认 false：rAF 持续运行会阻止低功耗模式，按需开启） */
    fpsEnabled: boolean
    /** FPS 采样时长 ms（默认 10000） */
    fpsSampleDurationMs: number
  }
  network: { collectResourceTiming: boolean }
  memory: { interval: number; reportOnlyOnGrowth: boolean; growthThresholdPerMinute: number }
}

/** 解析后的模块配置集合。 */
export type ResolvedModuleConfig = { [K in ModuleType]: ModuleConfigMap[K] }

/** 用户可传的模块配置（逐模块全部可选）。 */
export type UserModuleConfig = { [K in ModuleType]?: Partial<ModuleConfigMap[K]> }

/**
 * 上报传输方式。
 * - `fetch`（默认）：POST + 可读回执，能重试；
 * - `image`：GET 像素信标，跨域无需服务端配 CORS，但**读不到响应**（无法重试），
 *   且数据只能进 URL query（受长度限制）、不能带自定义请求头。
 */
export type TransportKind = 'fetch' | 'image'

/** 用户可传入的配置（全部可选，appId 必填）。 */
export type UserConfig = UserModuleConfig & {
  appId: string
  reportUrl?: string
  env?: 'production' | 'development' | 'test'
  modules?: ModuleType[]
  release?: string
  sample?: Partial<Record<ModuleType, number>>
  debounceTime?: number
  maxLogsPerPage?: number
  lazyReport?: boolean
  urlBlacklist?: string[]
  ignoreErrors?: Array<string | RegExp>
  dedupWindow?: number
  maskQueryKeys?: string[]
  reportPerformanceOnHiddenOnly?: boolean
  /** 行为栈容量上限（对齐 Sentry 的 maxBreadcrumbs，默认 20）。 */
  maxBreadcrumbs?: number
  /**
   * console 行为栈采集范围（不独立上报，只进 breadcrumb）。
   * - `off`：不劫持 console
   * - `error`：只记 error / assert
   * - `warn`（默认）：再加 warn
   * - `all`：含 log / info / debug（量大且隐私风险高，非排障需要不建议）
   */
  consoleBreadcrumb?: 'off' | 'error' | 'warn' | 'all'
  extra?: Record<string, unknown>
  tags?: Record<string, string>
  beforeSend?: (log: ReportLog) => ReportLog | null
  request?: (logs: ReportLog[]) => void | Promise<void>
  unloadRequest?: (logs: ReportLog[]) => void
  /** 上报传输方式，默认 `fetch`。 */
  transport?: TransportKind
  requestConfig?: { headers?: Record<string, string>; timeout?: number }
  debug?: boolean
}

/** 解析后的配置：所有字段已填默认值，全部只读。 */
export type ResolvedConfig = Readonly<ResolvedModuleConfig> & {
  readonly appId: string
  readonly reportUrl?: string
  readonly env: 'production' | 'development' | 'test'
  readonly modules: readonly ModuleType[]
  readonly release?: string
  readonly sample: Readonly<Record<ModuleType, number>>
  readonly debounceTime: number
  readonly maxLogsPerPage: number
  readonly lazyReport: boolean
  readonly urlBlacklist: readonly string[]
  readonly ignoreErrors: readonly (string | RegExp)[]
  readonly dedupWindow: number
  readonly maskQueryKeys: readonly string[]
  readonly reportPerformanceOnHiddenOnly: boolean
  readonly maxBreadcrumbs: number
  readonly consoleBreadcrumb: 'off' | 'error' | 'warn' | 'all'
  readonly extra: Record<string, unknown>
  readonly tags: Record<string, string>
  readonly beforeSend?: (log: ReportLog) => ReportLog | null
  readonly request?: (logs: ReportLog[]) => void | Promise<void>
  readonly unloadRequest?: (logs: ReportLog[]) => void
  readonly transport: TransportKind
  readonly requestConfig: { headers: Readonly<Record<string, string>>; timeout: number }
  readonly debug: boolean
}