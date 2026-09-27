// CLS 会话窗口测试（规格书第 11 章 perf.cls.test.ts 断言矩阵）。
import { beforeEach, describe, expect, it } from 'vitest'
import { ClsTracker } from '../../src/modules/performance/cls'
import { createPerformanceMonitor } from '../../src/modules/performance'
import { makeModuleCtx } from '../helpers'
import { MockPerformanceObserver } from '../setup'
import type { PerformanceData } from '../../src/contracts/log'

describe('ClsTracker', () => {
  it('hadRecentInput: true 的条目被跳过', () => {
    const tracker = new ClsTracker()
    tracker.onEntry({ value: 100, hadRecentInput: true, startTime: 0 })
    tracker.onEntry({ value: 0.1, hadRecentInput: false, startTime: 0 })
    expect(tracker.finalize().value).toBeCloseTo(0.1, 4)
  })

  it('间隔 >1s 开启新会话窗口；终值取最大窗口而非总和', () => {
    const tracker = new ClsTracker()
    tracker.onEntry({ value: 0.1, hadRecentInput: false, startTime: 0 })
    tracker.onEntry({ value: 0.2, hadRecentInput: false, startTime: 500 }) // 同窗 0.3
    tracker.onEntry({ value: 0.05, hadRecentInput: false, startTime: 2000 }) // 新窗 0.05
    tracker.onEntry({ value: 0.02, hadRecentInput: false, startTime: 2100 }) // 同新窗 0.07
    // 总和 0.37；最大窗口 0.3
    expect(tracker.finalize().value).toBeCloseTo(0.3, 4)
  })

  it('值保留 4 位小数', () => {
    const tracker = new ClsTracker()
    tracker.onEntry({ value: 0.123456, hadRecentInput: false, startTime: 0 })
    expect(tracker.finalize().value).toBeCloseTo(0.1235, 4)
  })
})

describe('PerformanceMonitor CLS 集成', () => {
  beforeEach(() => {
    MockPerformanceObserver.reset()
  })

  it('CLS = 0.05 时仍然上报（阈值默认 0，只用于 rating 不用于过滤）', () => {
    const { ctx, emitted } = makeModuleCtx()
    const module = createPerformanceMonitor()
    module.start(ctx)

    MockPerformanceObserver.trigger('layout-shift', [
      { value: 0.05, hadRecentInput: false, startTime: 10, sources: [] }
    ])
    ;(module as unknown as { onPageHidden?: () => void }).onPageHidden?.()

    const clsLogs = emitted
      .filter((e) => e.type === 'performance')
      .map((e) => e.data as PerformanceData)
      .filter((d) => d.metricName === 'CLS')
    expect(clsLogs.length).toBe(1)
    expect(clsLogs[0]?.value).toBeCloseTo(0.05, 4)
    expect(clsLogs[0]?.rating).toBe('good')
    module.stop()
  })
})