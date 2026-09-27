// Vue 插件测试（规格书第 11 章 vue.plugin.test.ts：原有 errorHandler 必须被调用）。
import { describe, expect, it, vi } from 'vitest'
import { vueErrorPlugin as vue3Plugin } from '../../src/plugins/vue3'
import { vueErrorPlugin as vue2Plugin } from '../../src/plugins/vue2'
import type { LogReport } from '../../src/core/LogReport'
import type { ErrorData } from '../../src/contracts/log'

function makeMonitor() {
  const addReport = vi.fn()
  return { addReport } as unknown as LogReport & { addReport: ReturnType<typeof vi.fn> }
}

type Handler = (err: unknown, instance: unknown, info: string) => void

interface AppLike {
  config: { errorHandler?: Handler | null }
}

/** 安全调用 errorHandler（避免与上一语句产生 ASI 歧义）。 */
function callHandler(app: AppLike, err: unknown, instance: unknown, info: string): void {
  const handler = app.config.errorHandler
  if (typeof handler === 'function') {
    handler(err, instance, info)
  }
}

describe('vue3 plugin', () => {
  it('挂载 errorHandler 且原有 handler 被调用（spy 断言）', () => {
    const monitor = makeMonitor()
    const prev = vi.fn() as Handler & ReturnType<typeof vi.fn>
    const app: AppLike = { config: { errorHandler: prev } }
    const err = new Error('vue3 boom')
    const instance = { $el: null }

    vue3Plugin.install(app, { monitor: monitor as unknown as LogReport })
    callHandler(app, err, instance, 'setup function')

    expect(monitor.addReport).toHaveBeenCalledTimes(1)
    const [type, data] = monitor.addReport.mock.calls[0] as [string, ErrorData]
    expect(type).toBe('error')
    expect(data.errorType).toBe('vue_error')
    expect(data.message).toBe('vue3 boom')
    expect(prev).toHaveBeenCalledTimes(1)
    expect(prev.mock.calls[0]).toEqual([err, instance, 'setup function'])
  })

  it('无原有 handler 时不抛错', () => {
    const monitor = makeMonitor()
    const app: AppLike = { config: { errorHandler: null } }
    vue3Plugin.install(app, { monitor: monitor as unknown as LogReport })
    expect(() => callHandler(app, new Error('x'), null, 'render')).not.toThrow()
    expect(monitor.addReport).toHaveBeenCalledTimes(1)
  })
})

describe('vue2 plugin', () => {
  it('挂载 Vue.config.errorHandler 且原有 handler 被调用', () => {
    const monitor = makeMonitor()
    const prev = vi.fn() as Handler & ReturnType<typeof vi.fn>
    const Vue: AppLike = { config: { errorHandler: prev } }
    const err = { message: 'vue2 boom' }

    vue2Plugin.install(Vue, { monitor: monitor as unknown as LogReport })
    callHandler(Vue, err, {}, 'mounted hook')

    expect(monitor.addReport).toHaveBeenCalledTimes(1)
    const [type, data] = monitor.addReport.mock.calls[0] as [string, ErrorData]
    expect(type).toBe('error')
    expect(data.errorType).toBe('vue_error')
    expect(prev).toHaveBeenCalledTimes(1)
  })

  it('字符串错误归一化为 message', () => {
    const monitor = makeMonitor()
    const Vue: AppLike = { config: { errorHandler: null } }
    vue2Plugin.install(Vue, { monitor: monitor as unknown as LogReport })
    callHandler(Vue, 'plain string err', {}, 'render')
    const [, data] = monitor.addReport.mock.calls[0] as [string, ErrorData]
    expect(data.message).toBe('plain string err')
    expect(data.stack).toBeUndefined()
  })
})