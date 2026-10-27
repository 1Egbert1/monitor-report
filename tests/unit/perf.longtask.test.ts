// Long Task 聚合与 LT 指标上报测试：
// 1. 只累加超过 50ms 的阻塞部分，不把整段任务时长算作阻塞；
// 2. 无长任务时不上报（不能报 0，否则稀释统计）；
// 3. LT 与 CLS / INP 同为累积型，在页面隐藏时结算。
import { beforeEach, describe, expect, it } from 'vitest'
import { createPerformanceMonitor } from '../../src/modules/performance'
import { LongTaskTracker } from '../../src/modules/performance/longtask'
import { makeModuleCtx } from '../helpers'
import { MockPerformanceObserver } from '../setup'
import type { PerformanceData } from '../../src/contracts/log'

/** 取出已上报的 LT 数据。 */
function ltData(
  emitted: ReturnType<typeof makeModuleCtx>['emitted']
): PerformanceData | undefined {
  return emitted
    .filter((e) => e.type === 'performance')
    .map((e) => e.data as PerformanceData)
    .find((d) => d.metricName === 'LT')
}

/** 触发一次隐藏结算（必须保持方法调用形式，否则 this 丢失）。 */
function settle(module: ReturnType<typeof createPerformanceMonitor>): void {
  const target = module as unknown as { onPageHidden?: () => void }
  target.onPageHidden?.()
}

describe('LongTaskTracker', () => {
  it('只累加超过 50ms 的部分作为阻塞时长', () => {
    const tracker = new LongTaskTracker()
    tracker.onEntry({ duration: 120, startTime: 1000 }) // 阻塞 70
    tracker.onEntry({ duration: 80, startTime: 2000 }) // 阻塞 30
    const result = tracker.finalize()
    expect(result?.value).toBe(100)
    expect(result?.count).toBe(2)
    expect(result?.maxDuration).toBe(120)
  })

  it('恰好 50ms 计入任务数但不产生阻塞时长', () => {
    const tracker = new LongTaskTracker()
    tracker.onEntry({ duration: 50, startTime: 1000 })
    const result = tracker.finalize()
    expect(result?.count).toBe(1)
    expect(result?.value).toBe(0)
  })

  it('没有长任务时返回 null，不上报 0', () => {
    expect(new LongTaskTracker().finalize()).toBeNull()
  })
})

describe('LT 指标上报', () => {
  beforeEach(() => {
    MockPerformanceObserver.reset()
    document.body.innerHTML = ''
  })

  it('页面隐藏时结算，携带阻塞时长、任务数与最长任务', () => {
    const { ctx, emitted } = makeModuleCtx()
    const module = createPerformanceMonitor()
    module.start(ctx)

    MockPerformanceObserver.trigger('longtask', [{ duration: 120, startTime: 1000 }])
    MockPerformanceObserver.trigger('longtask', [{ duration: 300, startTime: 5000 }])
    settle(module)

    const data = ltData(emitted)
    expect(data?.value).toBe(70 + 250)
    expect(data?.longTaskCount).toBe(2)
    expect(data?.maxLongTaskDuration).toBe(300)
    expect(data?.entryType).toBe('longtask')
    module.stop()
  })

  it('没有长任务时不上报 LT 指标', () => {
    const { ctx, emitted } = makeModuleCtx()
    const module = createPerformanceMonitor()
    module.start(ctx)

    settle(module)

    expect(ltData(emitted)).toBeUndefined()
    module.stop()
  })

  it('rating 按 200 / 600 分档（参考 Lighthouse TBT 口径）', () => {
    const { ctx, emitted } = makeModuleCtx()
    const module = createPerformanceMonitor()
    module.start(ctx)

    // 两条 150ms 任务 → 阻塞 200ms，落在 good 边界上
    MockPerformanceObserver.trigger('longtask', [{ duration: 150, startTime: 1000 }])
    MockPerformanceObserver.trigger('longtask', [{ duration: 150, startTime: 2000 }])
    settle(module)

    const data = ltData(emitted)
    expect(data?.value).toBe(200)
    expect(data?.rating).toBe('good')
    module.stop()
  })
})
