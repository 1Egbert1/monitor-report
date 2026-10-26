// 契约层：模块与核心之间的接口（模块自描述 + 生命周期）。
import type { LogDataOf, LogType } from './log'
import type { ModuleType, ResolvedConfig } from './config'

/** 上报出口：模块通过它把归一化后的数据交给核心管道。 */
export interface ReportEmitter {
  emit<T extends LogType>(type: T, data: LogDataOf<T>): void
}

/** 核心注入给模块的运行上下文。 */
export interface ModuleContext {
  config: ResolvedConfig
  emitter: ReportEmitter
  onTeardown(fn: () => void): void
  isPageHidden(): boolean
  now(): number
}

/** 采集模块统一生命周期接口。 */
export interface MonitorModule {
  readonly name: LogType
  start(ctx: ModuleContext): void
  stop(): void
}

/** 模块工厂：每次注入时新建一个模块实例。 */
export type ModuleFactory = () => MonitorModule

/**
 * 管道行为钩子：模块把自己的特化规则交给核心，核心不再出现 `if (type === 'xxx')`。
 * data 以 unknown 承载，调用侧的类型由 defineModule 保证。
 */
export interface ModuleBehavior {
  /** 规则过滤：返回 true 表示丢弃该条日志。 */
  filter?: (data: unknown, config: ResolvedConfig) => boolean
  /** timeOrigin 校正所用的 performance 事件起点（无则返回 0）。 */
  startTimeOf?: (data: unknown) => number
}

/** 模块自描述清单：注册、装配、管道钩子的唯一入口。 */
export interface ModuleDescriptor extends ModuleBehavior {
  readonly type: ModuleType
  readonly create: ModuleFactory
}

/** 描述符的声明形式（data 类型按模块收窄）。 */
export interface ModuleDeclaration<T extends ModuleType> {
  readonly type: T
  readonly create: ModuleFactory
  readonly filter?: (data: LogDataOf<T>, config: ResolvedConfig) => boolean
  readonly startTimeOf?: (data: LogDataOf<T>) => number
}

/**
 * 声明一个模块描述符。
 * 类型擦除只发生在这一处，调用侧拿到的是收窄后的 data 类型。
 * @param decl 模块声明
 */
export function defineModule<T extends ModuleType>(decl: ModuleDeclaration<T>): ModuleDescriptor {
  return {
    type: decl.type,
    create: decl.create,
    filter: decl.filter as ModuleBehavior['filter'],
    startTimeOf: decl.startTimeOf as ModuleBehavior['startTimeOf']
  }
}

/** 模块注册表：按类型映射描述符，允许部分注册（子路径入口只注册单个模块）。 */
export type ModuleRegistry = Partial<Record<ModuleType, ModuleDescriptor>>

/**
 * 从注册表提取管道行为表，键与日志类型一一对应，供 core 使用。
 * @param registry 模块注册表
 */
export function behaviorsOf(registry: ModuleRegistry): Partial<Record<LogType, ModuleBehavior>> {
  const behaviors: Partial<Record<LogType, ModuleBehavior>> = {}
  for (const type of Object.keys(registry) as ModuleType[]) {
    const desc = registry[type]
    if (!desc) continue
    behaviors[type] = { filter: desc.filter, startTimeOf: desc.startTimeOf }
  }
  return behaviors
}
