// 子路径入口：monitor-report/error（仅 core + 错误采集）。
// 入口与注册表在同一文件内，避免「入口 + entries 注册表」两处描述同一件事。
import { LogReport } from './core/LogReport'
import { createSingleton } from './core/singleton'
import { errorModule } from './modules/error'
import type { UserConfig } from './contracts/config'
import type { ModuleRegistry } from './contracts/emitter'

const registry: ModuleRegistry = { error: errorModule }

/**
 * 创建仅含错误采集的监控实例。
 * @param config 用户配置
 */
export function createMonitor(config: UserConfig): LogReport {
  return createSingleton(() => new LogReport({ ...config, modules: ['error'] }, registry))
}

export { LogReport }
export * from './contracts/log'
