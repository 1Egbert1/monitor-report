// 数据管道（规格书 6.3）：采样 → 类型开关 → 规则过滤 → 公共字段 → 脱敏 → beforeSend → 入队。
// 处理顺序固定，不得调整。模块特化规则由注册表注入的 behaviors 提供，核心不出现具体模块名。
import type { LogBase, LogDataOf, LogLevel, LogType, ReportLog } from '../contracts/log'
import type { ModuleType, ResolvedConfig } from '../contracts/config'
import type { ModuleBehavior } from '../contracts/emitter'
import type { NavigationType } from '../utils/time'
import { correctedNow } from '../utils/time'
import { maskLog, containsPii } from '../utils/mask'
import { schemaVersion, sdkVersion } from '../constants/version'
import { DEFAULT_LEVEL_BY_TYPE } from '../constants/defaults'
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
  /** 模块声明的管道行为（规则过滤 / 事件起点），键与日志类型对应。 */
  behaviors: Partial<Record<LogType, ModuleBehavior>>
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
   * 重放场景（lazyReport 缓存项）直接传整条原始对，避免调用侧按类型写 switch。
   * @param raw 原始数据对
   */
  process(raw: QueuedRaw): void
  /**
   * 处理一条原始数据并按序走完管道。
   * @param type 日志类型
   * @param data 数据类型化数据
   */
  process<T extends LogType>(type: T, data: LogDataOf<T>): void
  process<T extends LogType>(typeOrRaw: T | QueuedRaw, data?: LogDataOf<T>): void {
    const raw = (typeof typeOrRaw === 'string' ? { type: typeOrRaw, data } : typeOrRaw) as QueuedRaw
    const { type, data: payload } = raw
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

    // 3 规则过滤（模块自带：error 走 ignoreErrors、network 走 urlBlacklist，核心无需感知）
    const behavior = this.deps.behaviors[type]
    if (behavior?.filter?.(payload, config)) return

    // 4 补全公共字段（pageUrl 在此刻快照）+ 推导严重级别
    const log = this.buildLog(type, payload, this.levelOf(type, payload))

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
      this.deps.lazyPush(raw)
      return
    }
    this.deps.queue.add(out)
  }

  /**
   * 构造完整日志（公共字段 + data + level）。
   * @param type 日志类型
   * @param data 数据类型化数据
   * @param level 严重级别
   */
  private buildLog<T extends LogType>(type: T, data: LogDataOf<T>, level: LogLevel): ReportLog {
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
      data,
      level
    } as unknown as ReportLog
  }

  /**
   * 推导严重级别：模块声明优先，未声明时按类型兜底。
   * @param type 日志类型
   * @param data 数据类型化数据
   */
  private levelOf<T extends LogType>(type: T, data: LogDataOf<T>): LogLevel {
    return this.deps.behaviors[type]?.levelOf?.(data) ?? DEFAULT_LEVEL_BY_TYPE[type]
  }

  /**
   * 取该类型日志对应的 performance 事件起点（用于 timeOrigin 校正）。
   * 由模块描述符声明，未声明者取 0（校正退化为相对 timeOrigin 的偏移）。
   * @param type 日志类型
   * @param data 数据类型化数据
   */
  private entryStartOf<T extends LogType>(type: T, data: LogDataOf<T>): number {
    return this.deps.behaviors[type]?.startTimeOf?.(data) ?? 0
  }
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