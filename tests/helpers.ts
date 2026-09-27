// 测试公共助手：构造模块上下文与发射捕获。
import { resolveConfig } from '../src/core/config'
import type { ModuleContext } from '../src/contracts/emitter'
import type { UserConfig } from '../src/contracts/config'
import type { LogDataOf, LogType } from '../src/contracts/log'

/** 捕获到的发射项。 */
export interface EmittedItem {
  type: LogType
  data: LogDataOf<LogType>
}

/** 构造模拟模块上下文（配置 + emitter 捕获 + teardown 记录）。 */
export function makeModuleCtx(overrides: Partial<UserConfig> = {}) {
  const config = resolveConfig({
    appId: 'a',
    reportUrl: 'https://r.example.com/u',
    ...overrides
  })
  const teardowns: Array<() => void> = []
  const emitted: EmittedItem[] = []
  const ctx = {
    config,
    emitter: {
      emit: (type: LogType, data: LogDataOf<LogType>) => {
        emitted.push({ type, data })
      }
    },
    onTeardown: (fn: () => void) => {
      teardowns.push(fn)
    },
    isPageHidden: () => document.visibilityState === 'hidden',
    now: () => Date.now()
  } as unknown as ModuleContext
  return { config, ctx, emitted, teardowns }
}