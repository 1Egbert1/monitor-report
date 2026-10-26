// 契约层：ReportLog 联合类型与各维度 data 类型（纯类型，零逻辑）。

/** 日志大类：错误 / 性能 / 网络 / 内存 / 自定义。 */
export type LogType = 'error' | 'performance' | 'network' | 'memory' | 'custom'

/** 所有日志共有的基础字段。 */
export interface LogBase {
  appId: string
  type: LogType
  schemaVersion: number
  sdkVersion: string
  env: 'production' | 'development' | 'test'
  timestamp: number
  timeOriginCorrected: number
  pageUrl: string
  pagePath: string
  navigationType: 'navigate' | 'reload' | 'back_forward' | 'prerender' | 'unknown'
  ua: string
  sessionId: string
  userId?: string
  release?: string
  traceId?: string
  tags?: Record<string, string>
  extra?: Record<string, unknown>
}

/** 错误类日志承载数据。 */
export interface ErrorData {
  errorType: 'js_error' | 'promise_error' | 'resource_error' | 'vue_error'
  message: string
  stack?: string
  fileName?: string
  lineNo?: number
  colNo?: number
  resourceUrl?: string
  resourceType?: string
  selector?: string
  crossOrigin?: boolean
  count: number
  firstSeen: number
  lastSeen: number
}

/** 性能类日志承载数据。 */
export interface PerformanceData {
  metricName: 'FCP' | 'LCP' | 'FID' | 'INP' | 'CLS'
  value: number
  rating: 'good' | 'needs-improvement' | 'poor'
  entryType: string
  startTime: number
  interactionCount?: number
  layoutShiftSources?: string[]
}

/** 网络请求结果的语义分类（避免下游把一切失败统一渲染成「接口异常」）。 */
export type NetworkStatusCategory =
  | 'success'
  | 'redirect'
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'client_error'
  | 'server_error'
  | 'timeout'
  | 'aborted'
  | 'network_error'

/** 网络类日志承载数据。 */
export interface NetworkData {
  reqUrl: string
  reqMethod: string
  reqStartTime: number
  reqDuration: number
  resOk: boolean
  resStatus?: number
  resStatusText?: string
  aborted: boolean
  errorMessage?: string
  /** 结果语义分类：2xx / 400 / 401 / 403 / 404 / 其他 4xx / 5xx / 超时 / 取消 / 网络层失败。 */
  statusCategory?: NetworkStatusCategory
  /** 可直接展示的中文说明（含状态码与排查方向）。 */
  statusMessage?: string
  reqBodySize?: number
  resBodySize?: number
}

/** 内存类日志承载数据。 */
export interface MemoryData {
  usedJSHeapSize: number
  totalJSHeapSize: number
  jsHeapSizeLimit: number
  usageRate: number
  sampleIndex: number
  deltaBytes: number | null
  growthPerMinute: number | null
}

/** 错误日志（完整联合成员）。 */
export interface ErrorLog extends LogBase {
  type: 'error'
  data: ErrorData
}

/** 性能日志（完整联合成员）。 */
export interface PerformanceLog extends LogBase {
  type: 'performance'
  data: PerformanceData
}

/** 网络日志（完整联合成员）。 */
export interface NetworkLog extends LogBase {
  type: 'network'
  data: NetworkData
}

/** 内存日志（完整联合成员）。 */
export interface MemoryLog extends LogBase {
  type: 'memory'
  data: MemoryData
}

/** 自定义日志（完整联合成员）。 */
export interface CustomLog extends LogBase {
  type: 'custom'
  data: Record<string, unknown>
}

/** 所有可上报日志的联合类型。 */
export type ReportLog = ErrorLog | PerformanceLog | NetworkLog | MemoryLog | CustomLog

/** 由 LogType 推导对应 data 类型。 */
export type LogDataOf<T extends LogType> = T extends 'error'
  ? ErrorData
  : T extends 'performance'
    ? PerformanceData
    : T extends 'network'
      ? NetworkData
      : T extends 'memory'
        ? MemoryData
        : Record<string, unknown>