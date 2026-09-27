// 子路径入口：monitor-report/memory（仅 core + 内存采样）。
import { LogReport } from './core/LogReport'
import { createSingleton } from './core/singleton'
import { memoryRegistry } from './entries/memory'
import type { UserConfig } from './contracts/config'
import type { ModuleRegistry } from './contracts/emitter'

const registry: ModuleRegistry = memoryRegistry

/**
 * 创建仅含内存采样的监控实例。
 * @param config 用户配置
 */
export function createMonitor(config: UserConfig): LogReport {
  return createSingleton(() => new LogReport({ ...config, modules: ['memory'] }, registry))
}

export { LogReport }
export * from './contracts/log'