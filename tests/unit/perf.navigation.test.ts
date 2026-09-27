// 导航类型测试（规格书第 11 章 perf.navigation.test.ts 断言矩阵）。
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPerformanceMonitor } from '../../src/modules/performance'
import { makeModuleCtx } from '../helpers'
import { MockPerformanceObserver } from '../setup'
import type { PerformanceData } from '../../src/contracts/log'

/** 临时把 performance.getEntriesByType 覆写为返回指定导航类型。 */
function stubNavigationType(type: string): () => void {
  const original = performance.getEntriesByType
  const fn = (t: string): PerformanceEntryList => {
    if (t === 'navigation') {
      return [{ type }] as unknown as PerformanceEntryList
    }
    return []
  }
  Object.defineProperty(performance, 'getEntriesByType', {
    value: fn,
    configurable: true
  })
  return () => {
    Object.defineProperty(performance, 'getEntriesByType', {
      value: original,
      configurable: true
    })
  }
}

describe('PerformanceMonitor 导航类型', () => {
  let restore: () => void = () => undefined

  beforeEach(() => {
    MockPerformanceObserver.reset()
  })

  afterEach(() => {
    restore()
  })

  it('back_forward 时 FCP / LCP 不上报，INP / CLS 正常', () => {
    restore = stubNavigationType('back_forward')
    const { ctx, emitted } = makeModuleCtx()
    const module = createPerformanceMonitor()
    module.start(ctx)

    MockPerformanceObserver.trigger('paint', [
      { name: 'first-contentful-paint', startTime: 100 }
    ])
    MockPerformanceObserver.trigger('largest-contentful-paint', [{ startTime: 200 }])
    MockPerformanceObserver.trigger('layout-shift', [
      { value: 0.05, hadRecentInput: false, startTime: 10, sources: [] }
    ])
    MockPerformanceObserver.trigger('event', [
      { interactionId: 1, duration: 80 },
      { interactionId: 2, duration: 120 }
    ])

    ;(module as unknown as { onPageHidden?: () => void }).onPageHidden?.()

    const perfLogs = emitted
      .filter((e) => e.type === 'performance')
      .map((e) => e.data as PerformanceData)
    expect(perfLogs.filter((d) => d.metricName === 'FCP').length).toBe(0)
    expect(perfLogs.filter((d) => d.metricName === 'LCP').length).toBe(0)
    expect(perfLogs.filter((d) => d.metricName === 'CLS').length).toBe(1)
    const inp = perfLogs.find((d) => d.metricName === 'INP')
    expect(inp).toBeDefined()
    expect(inp?.interactionCount).toBe(2)
    module.stop()
  })

  it('navigate 时 FCP / LCP 正常上报', () => {
    restore = stubNavigationType('navigate')
    const { ctx, emitted } = makeModuleCtx()
    const module = createPerformanceMonitor()
    module.start(ctx)

    MockPerformanceObserver.trigger('paint', [
      { name: 'first-contentful-paint', startTime: 100 }
    ])
    MockPerformanceObserver.trigger('largest-contentful-paint', [{ startTime: 200 }])
    ;(module as unknown as { onPageHidden?: () => void }).onPageHidden?.()

    const perfLogs = emitted
      .filter((e) => e.type === 'performance')
      .map((e) => e.data as PerformanceData)
    expect(perfLogs.filter((d) => d.metricName === 'FCP').length).toBe(1)
    expect(perfLogs.filter((d) => d.metricName === 'LCP').length).toBe(1)
    module.stop()
  })
})