// 契约层：ReportLog 联合类型与各维度 data 类型（纯类型，零逻辑）。

/**
 * 严重级别（对齐 Sentry 的 event level；不含 Sentry 的 log 档，避免与 info 语义重叠）。
 * 仅表达「单条日志本身的严重度」，聚合后的优先级由上报服务端计算。
 */
export type LogLevel = 'fatal' | 'error' | 'warning' | 'info' | 'debug'

/** 所有日志共有的基础字段。 */
/** 导航类型（Navigation Timing）。 */
export type NavigationType = 'navigate' | 'reload' | 'back_forward' | 'prerender' | 'unknown'

/**
 * 单条日志骨架：只放「这条特有」的字段。
 * 公共信息（哪个应用、什么设备、哪个页面、哪次会话）由上报体的
 * `appInfo` / `deviceInfo` / `pageInfo` / `sessionInfo` 承载，不再逐条重复。
 */
export interface LogBase {
  type: LogType
  /** 事件发生时刻（毫秒时间戳）。有 performance 事件起点时用 `timeOrigin + startTime` 换算，更精确。 */
  timestamp: number
  /** 严重级别：由采集侧按确定性规则推导（见各模块 levelOf），beforeSend 可覆写。 */
  level?: LogLevel
}

/** 应用信息：哪个应用在上报。 */
export interface AppInfo {
  appId: string
  sdkVersion: string
  env: 'production' | 'development' | 'test'
  release?: string
}

/** 设备信息：什么浏览器 / 什么 UA。 */
export interface DeviceInfo {
  ua: string
}

/** 页面信息：哪个页面、怎么进来的。 */
export interface PageInfo {
  url: string
  path: string
  navigationType: NavigationType
}

/** 会话信息：哪次会话、哪个用户、哪条链路。 */
export interface SessionInfo {
  sessionId: string
  userId?: string
  traceId?: string
}

/**
 * 上报体（一次请求一批）。
 * 每块名字即内容：appInfo=哪个应用、deviceInfo=什么设备、pageInfo=哪个页面、
 * sessionInfo=哪次会话、logs=具体日志。整批共享的信息只存一份。
 */
export interface ReportPayload {
  schemaVersion: number
  /** 批次发出时刻（毫秒时间戳） */
  sentAt: number
  appInfo: AppInfo
  deviceInfo: DeviceInfo
  pageInfo: PageInfo
  sessionInfo: SessionInfo
  /** 宿主自定义标签（字符串键值，用于聚合筛选） */
  tags?: Record<string, string>
  /** 宿主自定义数据（任意结构，不参与聚合） */
  extra?: Record<string, unknown>
  logs: ReportLog[]
}

/** 错误类日志承载数据。 */
/**
 * 行为栈条目（对齐 Sentry breadcrumb 的字段语义）。
 * 不独立上报，只在错误上报时作为上下文快照附带。
 */
export interface Breadcrumb {
  /** 发生时刻（毫秒时间戳，与本 SDK 其他时间字段一致；Sentry 用秒级浮点） */
  timestamp: number
  /** 分类，对齐 Sentry 的命名：ui.click / ui.input / navigation / http / console */
  category: string
  /** 级别，与日志 level 同一套取值 */
  level: LogLevel
  /** 人类可读摘要，如 `click button#submit` */
  message: string
  /** 结构化附加信息（元素选择器、文本、data-* 埋点属性等） */
  data?: Record<string, unknown>
}

/** 错误数据结构。 */
export interface ErrorData {
  errorType: 'js_error' | 'promise_error' | 'resource_error' | 'vue_error' | 'react_error'
  message: string
  stack?: string
  fileName?: string
  lineNo?: number
  colNo?: number
  resourceUrl?: string
  resourceType?: string
  selector?: string
  crossOrigin?: boolean
  /** React 组件栈（`errorInfo.componentStack`，裁剪为前 10 层） */
  componentStack?: string
  /** 错误发生时刻的行为栈快照（最多 maxBreadcrumbs 条，按时间正序） */
  breadcrumbs?: Breadcrumb[]
  count: number
  firstSeen: number
  lastSeen: number
}

/** 性能类日志承载数据。 */
export interface PerformanceData {
  metricName: 'FCP' | 'LCP' | 'FID' | 'INP' | 'CLS' | 'LT' | 'FPS'
  value: number
  rating: 'good' | 'needs-improvement' | 'poor'
  entryType: string
  startTime: number
  interactionCount?: number
  layoutShiftSources?: string[]
  /** LCP 的最大内容元素（脱敏选择器，仅 LCP 有值）——用于定位"是哪个元素慢" */
  lcpElement?: string
  /** Long Task 个数（仅 LT 有值） */
  longTaskCount?: number
  /** 最长单个 Long Task 的时长 ms（仅 LT 有值） */
  maxLongTaskDuration?: number
  /** 掉帧率（0-1，仅 FPS 有值）——比平均 FPS 更能反映卡顿 */
  fpsDropRate?: number
  /** 最长单帧间隔 ms（仅 FPS 有值）——定位最卡的时刻 */
  maxFrameDuration?: number
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
/** 类型 → 数据结构的唯一映射表：新增采集维度只需在此加一行，其余联合类型自动成立。 */
export interface LogDataMap {
  error: ErrorData
  performance: PerformanceData
  network: NetworkData
  memory: MemoryData
  custom: Record<string, unknown>
}

/** 日志大类：错误 / 性能 / 网络 / 内存 / 自定义（由映射表键推导）。 */
export type LogType = keyof LogDataMap

/** 由 LogType 推导对应 data 类型。 */
export type LogDataOf<T extends LogType> = LogDataMap[T]

/** 某类型的完整日志（公共字段 + 类型化 data）。 */
export type LogOf<T extends LogType> = LogBase & { type: T; data: LogDataMap[T] }

/** 错误日志（完整联合成员）。 */
export type ErrorLog = LogOf<'error'>

/** 性能日志（完整联合成员）。 */
export type PerformanceLog = LogOf<'performance'>

/** 网络日志（完整联合成员）。 */
export type NetworkLog = LogOf<'network'>

/** 内存日志（完整联合成员）。 */
export type MemoryLog = LogOf<'memory'>

/** 自定义日志（完整联合成员）。 */
export type CustomLog = LogOf<'custom'>

/** 所有可上报日志的联合类型（由映射表自动展开，无需手工维护联合）。 */
export type ReportLog = { [K in LogType]: LogOf<K> }[LogType]