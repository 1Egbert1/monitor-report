// 全量模块清单：装配点只在这里出现一次，新增模块在数组里加一行即可。
import type { ModuleRegistry } from '../contracts/emitter'
import { errorModule } from './error'
import { performanceModule } from './performance'
import { networkModule } from './network'
import { memoryModule } from './memory'

/** 全部模块描述符（顺序即装配顺序）。 */
export const ALL_MODULES = [errorModule, performanceModule, networkModule, memoryModule] as const

/** 全量注册表：供主入口装配（子路径入口各自只注册单个模块，不引用本文件）。 */
export const FULL_REGISTRY: ModuleRegistry = Object.fromEntries(
  ALL_MODULES.map((mod) => [mod.type, mod])
)
