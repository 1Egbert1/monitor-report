// performance 子路径注册表。
import type { ModuleRegistry } from '../contracts/emitter'
import { createPerformanceMonitor } from '../modules/performance'

/** 仅 core + performance 的注册表。 */
export const performanceRegistry: ModuleRegistry = {
  performance: createPerformanceMonitor
}