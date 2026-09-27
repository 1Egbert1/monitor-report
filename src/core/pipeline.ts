// 数据管道（规格书 6.3）：采样 → 类型开关 → 规则过滤 → 公共字段 → 脱敏 → beforeSend → 入队。
// 处理顺序固定，不得调整。
import type {
  LogBase,
  LogDataOf,
  LogType,
  NetworkData,
  PerformanceData,
  ReportLog
} from '../contracts/log'
import type { ModuleType, ResolvedConfig } from '../contracts/config'
import type { NavigationType } from '../utils/time'
import { correctedNow } from '../utils/time'
import { maskLog, containsPii } from '../utils/mask'
import { schemaVersion, sdkVersion } from '../constants/version'
import type { ReportQueue } from './queue'

/** 未脱敏的原始入队项（lazyReport 模式缓存用，startReport 时重走完整管道）。 */
export type QueuedRaw = { [T in LogType]: { type: T; data: LogDataOf<T> } }[LogType]

/** 运行时计数器（采样丢弃 / 队列丢弃 / 上报失败）。 */
export interface RuntimeCounters {
  sampledOut: number
  dropped: number
  failed: number
}

/** 运行时可变公共字段上下文（由宿主 API 修改）。 */
export interface CommonContext {
  userId?: string
  traceId?: string
  tags: Record<string, string>
  extra: Record<string, unknown>
}

/** 页面快照（pageUrl 在采集时刻冻结，此后不再读取 location）。 */
export interface PageSnapshot {
  url: string
  path: string
}

/** 公共字段构造输入。 */
export interface BaseFieldInput {
  config: ResolvedConfig
  sessionId: string
  navigationType: NavigationType
  ua: string
  userId?: string
  traceId?: string
  tags: Record<string, string>
  extra: Record<string, unknown>
}

/** 管道依赖注入。 */
export interface PipelineDeps {
  config: ResolvedConfig
  queue: ReportQueue
  counters: RuntimeCounters
  getCommon(): CommonContext
  getPageSnapshot(): PageSnapshot
  getNavigationType(): NavigationType
  getUa(): string
  getSessionId(): string
  lazyPush?: (raw: QueuedRaw) => void
}

/**
 * 构造公共字段（LogBase 除 type/data 外的部分）。
 * @param input 公共字段来源
 * @param page 页面快照
 * @param entryStartTime 事件起点（用于 timeOrigin 校正）
 */
export function buildLogBase(
  input: BaseFieldInput,
  page: PageSnapshot,
  entryStartTime: number
): Omit<LogBase, 'type'> {
  return {
    appId: input.config.appId,
    schemaVersion,
    sdkVersion,
    env: input.config.env,
    timestamp: Date.now(),
    timeOriginCorrected: correctedNow(entryStartTime),
    pageUrl: page.url,
    pagePath: page.path,
    navigationType: input.navigationType,
    ua: input.ua,
    sessionId: input.sessionId,
    userId: input.userId,
    release: input.config.release,
    traceId: input.traceId,
    tags: { ...input.config.tags, ...input.tags },
    extra: { ...input.config.extra, ...input.extra }
  }
}

/**
 * 核心数据管道：所有 emit（模块采集与手动 addReport）都经由此处定序处理。
 */
export class Pipeline {
  constructor(private readonly deps: PipelineDeps) {}

  /**
   * 处理一条原始数据并按序走完管道。
   * @param type 日志类型
   * @param data 数据类型化数据
   */
  process<T extends LogType>(type: T, data: LogDataOf<T>): void {
    const { config } = this.deps

    // 1 采样判定
    const rate = type === 'custom' ? 1 : config.sample[type as ModuleType]
    if (Math.random() >= rate) {
      this.deps.counters.sampledOut++
      return
    }

    // 2 类型开关（custom 无模块开关，跳过）
    if (
      type !== 'custom' &&
      !(config.modules as readonly ModuleType[]).includes(type as ModuleType)
    ) {
      return
    }

    // 3 规则过滤
    if (type === 'error') {
      const message = (data as { message: string }).message
      if (matchesIgnore(message, config.ignoreErrors)) return
    }
    if (type === 'network') {
      const reqUrl = (data as NetworkData).reqUrl
      if (matchesBlacklist(reqUrl, config.urlBlacklist)) return
    }

    // 4 补全公共字段（pageUrl 在此刻快照）
    const log = this.buildLog(type, data)

    // 5 脱敏（不可跳过）
    const masked = maskLog(log, config.maskQueryKeys)

    // 6 beforeSend（返回 null 丢弃，否则使用返回值）
    const out = config.beforeSend ? config.beforeSend(masked) : masked
    if (out === null) return

    if (config.debug) {
      warnPiiInHostFields(out)
    }

    // 7 入队（lazyReport 时缓存原始对，等 startReport 重走管道）
    if (config.lazyReport && this.deps.lazyPush) {
      this.deps.lazyPush({ type, data } as QueuedRaw)
      return
    }
    this.deps.queue.add(out)
  }

  /**
   * 构造完整日志（公共字段 + data）。
   * @param type 日志类型
   * @param data 数据类型化数据
   */
  private buildLog<T extends LogType>(type: T, data: LogDataOf<T>): ReportLog {
    const { config } = this.deps
    const common = this.deps.getCommon()
    // SPEC-GAP: 泛型 type 无法直接收窄为联合成员，构建后经 unknown 断言为 ReportLog。
    return {
      ...buildLogBase(
        {
          config,
          sessionId: this.deps.getSessionId(),
          navigationType: this.deps.getNavigationType(),
          ua: this.deps.getUa(),
          userId: common.userId,
          traceId: common.traceId,
          tags: common.tags,
          extra: common.extra
        },
        this.deps.getPageSnapshot(),
        this.entryStartOf(type, data)
      ),
      type,
      data
    } as unknown as ReportLog
  }

  /**
   * 取该类型日志对应的 performance 事件起点（用于 timeOrigin 校正）。
   * @param type 日志类型
   * @param data 数据类型化数据
   */
  private entryStartOf<T extends LogType>(type: T, data: LogDataOf<T>): number {
    if (type === 'performance') return (data as PerformanceData).startTime
    if (type === 'network') return (data as NetworkData).reqStartTime
    // SPEC-GAP: 错误/内存/自定义日志无 PerformanceEntry，startTime 取 0（校正退化为相对 timeOrigin 的偏移）。
    return 0
  }
}

/**
 * ignoreErrors 命中判定：string 子串匹配，RegExp 匹配（重置 lastIndex）。
 * @param message 错误消息
 * @param rules 忽略规则
 */
function matchesIgnore(message: string, rules: readonly (string | RegExp)[]): boolean {
  return rules.some((rule) => {
    if (typeof rule === 'string') return message.includes(rule)
    rule.lastIndex = 0
    return rule.test(message)
  })
}

/**
 * urlBlacklist 命中判定（子串匹配）。
 * @param url 请求地址
 * @param blacklist 黑名单
 */
function matchesBlacklist(url: string, blacklist: readonly string[]): boolean {
  return blacklist.some((item) => url.includes(item))
}

/**
 * debug 模式下检测宿主字段（extra/tags）中的 PII 并打印 warning。
 * extra/tags/custom 不递归清洗，属宿主责任（规格书第 9 章）。
 * @param log 待上报日志
 */
function warnPiiInHostFields(log: ReportLog): void {
  try {
    const payload = JSON.stringify({ extra: log.extra, tags: log.tags })
    if (payload && containsPii(payload)) {
      console.warn(
        '[monitor-report] PII detected in extra/tags; host is responsible for sanitizing these fields'
      )
    }
  } catch {
    // 序列化失败（如循环引用）时静默跳过
  }
}