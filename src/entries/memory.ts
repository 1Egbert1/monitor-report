// memory 子路径注册表。
import type { ModuleRegistry } from '../contracts/emitter'
import { createMemoryMonitor } from '../modules/memory'

/** 仅 core + memory 的注册表。 */
export const memoryRegistry: ModuleRegistry = {
  memory: createMemoryMonitor
}