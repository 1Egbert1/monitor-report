// 全量模块注册表（entries 层：核心与模块的装配点）。
import type { ModuleRegistry } from '../contracts/emitter'
import { createErrorMonitor } from '../modules/error'
import { createPerformanceMonitor } from '../modules/performance'
import { createNetworkMonitor } from '../modules/network'
import { createMemoryMonitor } from '../modules/memory'

/** 全量入口注册表：四个模块全部装配（内存模块默认不开启，见默认 modules）。 */
export const fullRegistry: ModuleRegistry = {
  error: createErrorMonitor,
  performance: createPerformanceMonitor,
  network: createNetworkMonitor,
  memory: createMemoryMonitor
}