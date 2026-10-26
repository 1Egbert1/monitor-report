// 子路径入口：monitor-report/network（仅 core + 网络采集）。
import { LogReport } from './core/LogReport'
import { createSingleton } from './core/singleton'
import { networkModule } from './modules/network'
import type { UserConfig } from './contracts/config'
import type { ModuleRegistry } from './contracts/emitter'

const registry: ModuleRegistry = { network: networkModule }

/**
 * 创建仅含网络采集的监控实例。
 * @param config 用户配置
 */
export function createMonitor(config: UserConfig): LogReport {
  return createSingleton(() => new LogReport({ ...config, modules: ['network'] }, registry))
}

export { LogReport }
export { classifyNetworkOutcome } from './modules/network/status'
export type { NetworkOutcome, NetworkOutcomeInput } from './modules/network/status'
export * from './contracts/log'
