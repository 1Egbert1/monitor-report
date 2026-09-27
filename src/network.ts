// 子路径入口：monitor-report/network（仅 core + 网络采集）。
import { LogReport } from './core/LogReport'
import { createSingleton } from './core/singleton'
import { networkRegistry } from './entries/network'
import type { UserConfig } from './contracts/config'
import type { ModuleRegistry } from './contracts/emitter'

const registry: ModuleRegistry = networkRegistry

/**
 * 创建仅含网络采集的监控实例。
 * @param config 用户配置
 */
export function createMonitor(config: UserConfig): LogReport {
  return createSingleton(() => new LogReport({ ...config, modules: ['network'] }, registry))
}

export { LogReport }
export * from './contracts/log'