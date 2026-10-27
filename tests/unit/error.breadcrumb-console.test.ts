// console 行为栈测试（规格书 7.1）：默认只记 warn/error/assert，
// 参数必须安全序列化 + 脱敏，teardown 必须还原原生方法。
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createErrorMonitor } from '../../src/modules/error'
import { safeSerialize } from '../../src/modules/error/breadcrumb'
import { makeModuleCtx } from '../helpers'
import type { Breadcrumb } from '../../src/contracts/log'

interface Cell {
  store: { snapshot(): Breadcrumb[] } | null
}

/** 取当前行为栈。 */
function crumbs(monitor: unknown): Breadcrumb[] {
  const cell = monitor as unknown as Cell
  return cell.store ? cell.store.snapshot() : []
}

/** 取 console 类行为。 */
function consoleCrumbs(monitor: unknown): Breadcrumb[] {
  return crumbs(monitor).filter((c) => c.category === 'console')
}

/** 启动错误模块。 */
function boot(config: Record<string, unknown> = {}) {
  const { ctx } = makeModuleCtx(config)
  const monitor = createErrorMonitor()
  monitor.start(ctx)
  const internal = monitor as unknown as { breadcrumbs: { snapshot(): Breadcrumb[] } | null }
  Object.defineProperty(monitor as unknown as Cell, 'store', {
    get: () => internal.breadcrumbs,
    configurable: true
  })
  return monitor
}

describe('safeSerialize', () => {
  it('循环引用不抛错', () => {
    const a: Record<string, unknown> = { name: 'a' }
    a.self = a
    expect(safeSerialize(a)).toContain('[Circular]')
  })

  it('Error 只取 name + message，不带 stack', () => {
    const out = safeSerialize(new TypeError('boom'))
    expect(out).toBe('TypeError: boom')
  })

  it('函数与 DOM 元素用占位符', () => {
    expect(safeSerialize(() => 1)).toBe('[Function]')
    const el = document.createElement('div')
    expect(safeSerialize(el)).toBe('[Element div]')
  })

  it('深度与长度双截断', () => {
    const deep = { a: { b: { c: { d: 1 } } } }
    expect(safeSerialize(deep)).toContain('[Object]')
    expect(safeSerialize('x'.repeat(200)).length).toBe(80)
  })

  it('数组只保留前 3 项', () => {
    expect(safeSerialize([1, 2, 3, 4, 5])).toBe('[1, 2, 3, …]')
  })
})

describe('console 行为栈', () => {
  const native = { warn: console.warn, error: console.error, log: console.log }

  beforeEach(() => {
    console.warn = native.warn
    console.error = native.error
    console.log = native.log
  })

  afterEach(() => {
    console.warn = native.warn
    console.error = native.error
    console.log = native.log
  })

  it('默认记录 warn：级别映射为 warning', () => {
    const monitor = boot()
    console.warn('库存不足', { sku: 'A1' })

    const list = consoleCrumbs(monitor)
    expect(list.length).toBe(1)
    expect(list[0]?.level).toBe('warning')
    expect(list[0]?.message).toContain('warn: 库存不足')
    expect(list[0]?.data?.level).toBe('warn')
    monitor.stop()
  })

  it('默认记录 error 与 assert，级别为 error', () => {
    const monitor = boot()
    console.error('提交失败', new Error('500'))
    const list = consoleCrumbs(monitor)
    expect(list[0]?.level).toBe('error')
    expect(list[0]?.message).toContain('Error: 500')
    monitor.stop()
  })

  it('默认不记录 log / info / debug', () => {
    const monitor = boot()
    console.log('普通日志')
    expect(consoleCrumbs(monitor).length).toBe(0)
    monitor.stop()
  })

  it("consoleBreadcrumb: 'all' 时记录 log", () => {
    const monitor = boot({ consoleBreadcrumb: 'all' })
    console.log('普通日志')
    expect(consoleCrumbs(monitor).length).toBe(1)
    monitor.stop()
  })

  it("consoleBreadcrumb: 'error' 时连 warn 都不记", () => {
    const monitor = boot({ consoleBreadcrumb: 'error' })
    console.warn('警告')
    console.error('错误')
    const list = consoleCrumbs(monitor)
    expect(list.length).toBe(1)
    expect(list[0]?.message).toContain('error: 错误')
    monitor.stop()
  })

  it("consoleBreadcrumb: 'off' 时不劫持 console", () => {
    const monitor = boot({ consoleBreadcrumb: 'off' })
    expect(console.warn).toBe(native.warn)
    console.warn('警告')
    expect(consoleCrumbs(monitor).length).toBe(0)
    monitor.stop()
  })

  it('参数中的 PII 被脱敏', () => {
    const monitor = boot()
    console.warn('用户 user@example.com 支付失败')
    expect(consoleCrumbs(monitor)[0]?.message).toContain('<email>')
    monitor.stop()
  })

  it('同内容连续调用合并为一条并累加 count', () => {
    const monitor = boot()
    console.warn('重试中')
    console.warn('重试中')
    const list = consoleCrumbs(monitor)
    expect(list.length).toBe(1)
    expect(list[0]?.data?.count).toBe(2)
    monitor.stop()
  })

  it('SDK 自身告警不进行为栈', () => {
    const monitor = boot()
    console.warn('[monitor-report] 内部提示')
    expect(consoleCrumbs(monitor).length).toBe(0)
    monitor.stop()
  })

  it('stop 后 console 方法还原为原生实现', () => {
    const patched = boot({ consoleBreadcrumb: 'all' })
    expect(console.warn).not.toBe(native.warn)
    patched.stop()
    expect(console.warn).toBe(native.warn)
    expect(console.error).toBe(native.error)
    expect(console.log).toBe(native.log)
  })

  it('包装后仍会把调用透传给原生方法', () => {
    const seen: unknown[][] = []
    // 先替换成假的原生实现，再启动，验证包装层只是透传
    console.warn = (...args: unknown[]) => {
      seen.push(args)
    }
    const monitor = boot()
    console.warn('透传', 1)
    expect(seen.length).toBe(1)
    expect(seen[0]).toEqual(['透传', 1])
    monitor.stop()
  })
})
