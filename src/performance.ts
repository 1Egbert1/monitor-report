// 子路径入口：monitor-report/performance（仅 core + 性能采集）。
import { LogReport } from './core/LogReport'
import { createSingleton } from './core/singleton'
import { performanceModule } from './modules/performance'
import type { UserConfig } from './contracts/config'
import type { ModuleRegistry } from './contracts/emitter'

const registry: ModuleRegistry = { performance: performanceModule }

/**
 * 创建仅含性能采集的监控实例。
 * @param config 用户配置
 */
export function createMonitor(config: UserConfig): LogReport {
  return createSingleton(() => new LogReport({ ...config, modules: ['performance'] }, registry))
}

export { LogReport }
export * from './contracts/log'
