// network 子路径注册表。
import type { ModuleRegistry } from '../contracts/emitter'
import { createNetworkMonitor } from '../modules/network'

/** 仅 core + network 的注册表。 */
export const networkRegistry: ModuleRegistry = {
  network: createNetworkMonitor
}