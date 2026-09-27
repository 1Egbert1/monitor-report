// 契约层：模块与核心之间的接口（纯类型，零逻辑）。
import type { LogDataOf, LogType } from './log'
import type { ResolvedConfig } from './config'

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

/** 模块注册表：按类型映射工厂，允许部分注册。 */
export type ModuleRegistry = Partial<Record<LogType, ModuleFactory>>