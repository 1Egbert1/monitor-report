// 生命周期测试（规格书第 11 章 core.lifecycle.test.ts 断言矩阵）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LogReport } from '../../src/core/LogReport'
import type { MonitorModule } from '../../src/contracts/emitter'
import type { LogType } from '../../src/contracts/log'

/** 构造一个检测清理行为的假模块。 */
function makeSpyModule() {
  const spies = {
    stop: vi.fn(),
    disconnect: vi.fn(),
    offListener: vi.fn()
  }
  const mod: MonitorModule = {
    name: 'error' as LogType,
    start(ctx) {
      const off = (): void => spies.offListener()
      // 模拟真实模块：注册监听清理与 Observer 断开
      ctx.onTeardown(() => {
        spies.disconnect()
      })
      ctx.onTeardown(off)
    },
    stop() {
      spies.stop()
      spies.offListener()
    }
  }
  return { mod, spies }
}

describe('LogReport 生命周期', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    delete window.__MONITOR_REPORT__
  })

  it('destroy() 后监听被移除、Observer 断开、定时器清空', () => {
    const { mod, spies } = makeSpyModule()
    const winRemove = vi.spyOn(window, 'removeEventListener')
    const docRemove = vi.spyOn(document, 'removeEventListener')

    const monitor = new LogReport(
      { appId: 'a', reportUrl: 'https://r.example.com/u', modules: ['error'] },
      { error: () => mod }
    )
    monitor.addReport('custom', { n: 1 }) // 触发防抖定时器
    expect(vi.getTimerCount()).toBeGreaterThan(0)

    monitor.destroy()
    expect(spies.stop).toHaveBeenCalled()
    expect(spies.disconnect).toHaveBeenCalled()
    expect(docRemove.mock.calls.map((c) => c[0])).toContain('visibilitychange')
    expect(winRemove.mock.calls.map((c) => c[0])).toContain('pagehide')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('destroy() 后不再接收上报，重复 destroy 不抛错', () => {
    const monitor = new LogReport({
      appId: 'a',
      reportUrl: 'https://r.example.com/u'
    })
    monitor.addReport('custom', { n: 1 })
    monitor.destroy()
    monitor.destroy()
    monitor.addReport('custom', { n: 2 })
    expect(monitor.getStatus()).toEqual({ queued: 0, dropped: 0, failed: 0, disabled: false })
  })

  it('destroy({ flush: false }) 不触发 flush', () => {
    const monitor = new LogReport({
      appId: 'a',
      reportUrl: 'https://r.example.com/u'
    })
    monitor.addReport('custom', { n: 1 })
    monitor.destroy({ flush: false })
    // 不 flush 时缓存被直接清空
    expect(monitor.getStatus().queued).toBe(0)
  })

  it('isBrowser() 为 false 时不抛错且不上报', () => {
    vi.stubGlobal('window', undefined)
    const monitor = new LogReport({
      appId: 'a',
      reportUrl: 'https://r.example.com/u'
    })
    expect(monitor.getStatus()).toEqual({ queued: 0, dropped: 0, failed: 0, disabled: true })
    expect(() => {
      monitor.addReport('custom', { n: 1 })
      monitor.setUser('u1')
      monitor.startReport()
      monitor.flushReport()
      monitor.destroy()
    }).not.toThrow()
  })
})