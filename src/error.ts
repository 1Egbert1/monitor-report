// 子路径入口：monitor-report/error（仅 core + 错误采集）。
import { LogReport } from './core/LogReport'
import { createSingleton } from './core/singleton'
import { errorRegistry } from './entries/error'
import type { UserConfig } from './contracts/config'
import type { ModuleRegistry } from './contracts/emitter'

const registry: ModuleRegistry = errorRegistry

/**
 * 创建仅含错误采集的监控实例。
 * @param config 用户配置
 */
export function createMonitor(config: UserConfig): LogReport {
  return createSingleton(() => new LogReport({ ...config, modules: ['error'] }, registry))
}

export { LogReport }
export * from './contracts/log'