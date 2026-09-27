// error 子路径注册表。
import type { ModuleRegistry } from '../contracts/emitter'
import { createErrorMonitor } from '../modules/error'

/** 仅 core + error 的注册表。 */
export const errorRegistry: ModuleRegistry = {
  error: createErrorMonitor
}