// 单例保护测试（规格书第 11 章 singleton.test.ts 断言矩阵）。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSingleton, unregisterSingleton, type SingletonInstance } from '../../src/core/singleton'

describe('createSingleton', () => {
  beforeEach(() => {
    delete window.__MONITOR_REPORT__
    vi.restoreAllMocks()
  })

  it('首次创建登记到全局槽位', () => {
    const instance: SingletonInstance = { destroy: vi.fn() }
    const out = createSingleton(() => instance)
    expect(out).toBe(instance)
    expect(window.__MONITOR_REPORT__?.instance).toBe(instance)
  })

  it('二次创建（相同版本）复用已有实例并打印 warning', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const first: SingletonInstance = { destroy: vi.fn() }
    createSingleton(() => first)
    const second = createSingleton(() => ({ destroy: vi.fn() }))
    expect(second).toBe(first)
    expect(warnSpy).toHaveBeenCalled()
    expect(first.destroy).not.toHaveBeenCalled()
  })

  it('版本不同时 destroy 旧实例并新建', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const old: SingletonInstance = { destroy: vi.fn() }
    window.__MONITOR_REPORT__ = { version: '0.0.0', instance: old }
    const created: SingletonInstance = { destroy: vi.fn() }
    const out = createSingleton(() => created)
    expect(old.destroy).toHaveBeenCalledWith({ flush: true })
    expect(out).toBe(created)
    expect(window.__MONITOR_REPORT__?.instance).toBe(created)
    expect(warnSpy).toHaveBeenCalled()
  })

  it('unregisterSingleton 只移除自身', () => {
    const a: SingletonInstance = { destroy: vi.fn() }
    createSingleton(() => a)
    unregisterSingleton({ destroy: vi.fn() })
    expect(window.__MONITOR_REPORT__?.instance).toBe(a)
    unregisterSingleton(a)
    expect(window.__MONITOR_REPORT__).toBeUndefined()
  })
})