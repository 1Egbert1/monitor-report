// 契约层：配置类型（纯类型，零逻辑）。
import type { ReportLog } from './log'

/** 模块类型（可枚举的采集维度）。 */
export type ModuleType = 'error' | 'performance' | 'network' | 'memory'

/** 用户可传入的配置（全部可选，appId 必填）。 */
export interface UserConfig {
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
  extra?: Record<string, unknown>
  tags?: Record<string, string>
  beforeSend?: (log: ReportLog) => ReportLog | null
  request?: (logs: ReportLog[]) => void | Promise<void>
  unloadRequest?: (logs: ReportLog[]) => void
  requestConfig?: { headers?: Record<string, string>; timeout?: number }
  performance?: { clsReportThreshold?: number }
  network?: { collectResourceTiming?: boolean }
  memory?: {
    interval?: number
    reportOnlyOnGrowth?: boolean
    growthThresholdPerMinute?: number
  }
  debug?: boolean
}

/** 解析后的配置：所有字段已填默认值，全部只读。 */
export interface ResolvedConfig {
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
  readonly extra: Record<string, unknown>
  readonly tags: Record<string, string>
  readonly beforeSend?: (log: ReportLog) => ReportLog | null
  readonly request?: (logs: ReportLog[]) => void | Promise<void>
  readonly unloadRequest?: (logs: ReportLog[]) => void
  readonly requestConfig: { headers: Readonly<Record<string, string>>; timeout: number }
  readonly performance: { clsReportThreshold: number }
  readonly network: { collectResourceTiming: boolean }
  readonly memory: {
    interval: number
    reportOnlyOnGrowth: boolean
    growthThresholdPerMinute: number
  }
  readonly debug: boolean
}