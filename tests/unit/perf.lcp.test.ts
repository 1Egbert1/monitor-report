// LCP 终值状态机测试（规格书第 11 章 perf.lcp.test.ts 断言矩阵）。
import { beforeEach, describe, expect, it } from 'vitest'
import { LcpTracker } from '../../src/modules/performance/lcp'
import { createPerformanceMonitor } from '../../src/modules/performance'
import { makeModuleCtx } from '../helpers'
import { MockPerformanceObserver } from '../setup'
import type { PerformanceData } from '../../src/contracts/log'

describe('LcpTracker', () => {
  it('连续 3 个递增候选后 finalize 取最大值（非首次值）', () => {
    const tracker = new LcpTracker()
    tracker.onEntry({ startTime: 120 })
    tracker.onEntry({ startTime: 310 })
    tracker.onEntry({ startTime: 180 })
    expect(tracker.value).toBe(310)
    expect(tracker.finalize()).toBe(310)
  })

  it('递减候选不覆盖当前最大值', () => {
    const tracker = new LcpTracker()
    tracker.onEntry({ startTime: 500 })
    tracker.onEntry({ startTime: 100 })
    expect(tracker.value).toBe(500)
  })
})

describe('PerformanceMonitor LCP 集成', () => {
  beforeEach(() => {
    MockPerformanceObserver.reset()
  })

  it('未在首个 entry 后 disconnect；finalize 时 disconnect 次数 ≤ 1 且晚于结算', () => {
    const { ctx, emitted } = makeModuleCtx()
    const module = createPerformanceMonitor()
    module.start(ctx)

    MockPerformanceObserver.trigger('largest-contentful-paint', [
      { startTime: 100 },
      { startTime: 250 },
      { startTime: 180 }
    ])
    const lcpObs = MockPerformanceObserver.findByType('largest-contentful-paint')
    expect(lcpObs).toBeDefined()
    expect(lcpObs?.disconnectedCount).toBe(0) // 首个 entry 后未断开

    ;(module as unknown as { onPageHidden?: () => void }).onPageHidden?.()
    expect(lcpObs?.disconnectedCount).toBe(1)

    const lcpLogs = emitted
      .filter((e) => e.type === 'performance')
      .map((e) => e.data as PerformanceData)
      .filter((d) => d.metricName === 'LCP')
    expect(lcpLogs.length).toBe(1)
    expect(lcpLogs[0]?.value).toBe(250)
    module.stop()
  })
})