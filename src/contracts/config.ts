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
  performance: { clsReportThreshold: number }
  network: { collectResourceTiming: boolean }
  memory: { interval: number; reportOnlyOnGrowth: boolean; growthThresholdPerMinute: number }
}

/** 解析后的模块配置集合。 */
export type ResolvedModuleConfig = { [K in ModuleType]: ModuleConfigMap[K] }

/** 用户可传的模块配置（逐模块全部可选）。 */
export type UserModuleConfig = { [K in ModuleType]?: Partial<ModuleConfigMap[K]> }

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
  extra?: Record<string, unknown>
  tags?: Record<string, string>
  beforeSend?: (log: ReportLog) => ReportLog | null
  request?: (logs: ReportLog[]) => void | Promise<void>
  unloadRequest?: (logs: ReportLog[]) => void
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
  readonly extra: Record<string, unknown>
  readonly tags: Record<string, string>
  readonly beforeSend?: (log: ReportLog) => ReportLog | null
  readonly request?: (logs: ReportLog[]) => void | Promise<void>
  readonly unloadRequest?: (logs: ReportLog[]) => void
  readonly requestConfig: { headers: Readonly<Record<string, string>>; timeout: number }
  readonly debug: boolean
}