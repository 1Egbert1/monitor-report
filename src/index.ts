// 全量入口：createMonitor()（组装全部模块 + 单例去重保护）。
import { LogReport } from './core/LogReport'
import { createSingleton } from './core/singleton'
import { fullRegistry } from './entries/full'
import type { UserConfig } from './contracts/config'

/**
 * 创建监控实例（全量模块注册表；重复注入时复用已有实例，见规格书 6.7）。
 * @param config 用户配置
 */
export function createMonitor(config: UserConfig): LogReport {
  return createSingleton(() => new LogReport(config, fullRegistry))
}

export { LogReport }
export * from './contracts/log'
export * from './contracts/config'
export * from './contracts/emitter'