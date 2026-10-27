// LCP 冻结与「不等隐藏」上报语义测试（规格书 7.2）：
// 1. 首次交互后 LCP 冻结，后台标签页回来产生的超大 startTime 不得混入；
// 2. reportPerformanceOnHiddenOnly=false 时 FCP/LCP 采集即上报，且隐藏结算不重复上报。
import { beforeEach, describe, expect, it } from 'vitest'
import { createPerformanceMonitor } from '../../src/modules/performance'
import { makeModuleCtx } from '../helpers'
import { MockPerformanceObserver } from '../setup'
import type { PerformanceData } from '../../src/contracts/log'

/** 模拟用户首次交互。 */
function triggerClick(): void {
  document.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

/** 取出某指标的已上报值。 */
function values(emitted: ReturnType<typeof makeModuleCtx>['emitted'], metric: string): number[] {
  return emitted
    .filter((e) => e.type === 'performance')
    .map((e) => e.data as PerformanceData)
    .filter((d) => d.metricName === metric)
    .map((d) => d.value)
}

/** 触发一次隐藏结算。 */
function settle(module: ReturnType<typeof createPerformanceMonitor>): void {
  ;(module as unknown as { onPageHidden?: () => void }).onPageHidden?.()
}

describe('LCP 首次交互冻结', () => {
  beforeEach(() => {
    MockPerformanceObserver.reset()
  })

  it('首次交互后不再采纳新候选（后台回来产生的超大 startTime 被拒）', () => {
    const { ctx, emitted } = makeModuleCtx()
    const module = createPerformanceMonitor()
    module.start(ctx)

    MockPerformanceObserver.trigger('largest-contentful-paint', [{ startTime: 1200 }])
    triggerClick()

    // 模拟用户切到别的标签页很久后回来，浏览器再次 paint 出一个超大候选
    MockPerformanceObserver.trigger('largest-contentful-paint', [{ startTime: 380000 }])

    settle(module)
    expect(values(emitted, 'LCP')).toEqual([1200])
    module.stop()
  })

  it('冻结时只断开 LCP Observer，CLS / INP 仍继续观察', () => {
    const { ctx, emitted } = makeModuleCtx()
    const module = createPerformanceMonitor()
    module.start(ctx)

    const lcpObs = MockPerformanceObserver.findByType('largest-contentful-paint')
    const clsObs = MockPerformanceObserver.findByType('layout-shift')
    triggerClick()

    expect(lcpObs?.disconnectedCount).toBe(1)
    expect(clsObs?.disconnectedCount).toBe(0)

    // 冻结后 CLS 仍能采集
    MockPerformanceObserver.trigger('layout-shift', [
      { value: 0.1, startTime: 100, hadRecentInput: false, sources: [] }
    ])
    settle(module)
    expect(values(emitted, 'CLS')).toEqual([0.1])
    module.stop()
  })

  it('未交互时保持原行为：持续取最大候选，隐藏时结算', () => {
    const { ctx, emitted } = makeModuleCtx()
    const module = createPerformanceMonitor()
    module.start(ctx)

    MockPerformanceObserver.trigger('largest-contentful-paint', [
      { startTime: 800 },
      { startTime: 1500 },
      { startTime: 1100 }
    ])
    triggerClick()
    settle(module)
    expect(values(emitted, 'LCP')).toEqual([1500])
    module.stop()
  })
})

describe('reportPerformanceOnHiddenOnly=false 的上报时机', () => {
  beforeEach(() => {
    MockPerformanceObserver.reset()
  })

  it('FCP 采集即上报，且隐藏结算不重复上报', () => {
    const { ctx, emitted } = makeModuleCtx({ reportPerformanceOnHiddenOnly: false })
    const module = createPerformanceMonitor()
    module.start(ctx)

    MockPerformanceObserver.trigger('paint', [
      { name: 'first-paint', startTime: 100 },
      { name: 'first-contentful-paint', startTime: 300 }
    ])
    expect(values(emitted, 'FCP')).toEqual([300])

    settle(module)
    // 回归点：旧实现这里会再报一次 FCP
    expect(values(emitted, 'FCP')).toEqual([300])
    module.stop()
  })

  it('LCP 在首次交互冻结时立即上报，隐藏结算不重复', () => {
    const { ctx, emitted } = makeModuleCtx({ reportPerformanceOnHiddenOnly: false })
    const module = createPerformanceMonitor()
    module.start(ctx)

    MockPerformanceObserver.trigger('largest-contentful-paint', [{ startTime: 2000 }])
    expect(values(emitted, 'LCP')).toEqual([]) // 尚未冻结，不能提前上报

    triggerClick()
    expect(values(emitted, 'LCP')).toEqual([2000]) // 冻结即上报

    settle(module)
    expect(values(emitted, 'LCP')).toEqual([2000])
    module.stop()
  })

  it('默认（true）时 FCP / LCP 都等到隐藏才上报', () => {
    const { ctx, emitted } = makeModuleCtx()
    const module = createPerformanceMonitor()
    module.start(ctx)

    MockPerformanceObserver.trigger('paint', [{ name: 'first-contentful-paint', startTime: 300 }])
    MockPerformanceObserver.trigger('largest-contentful-paint', [{ startTime: 900 }])
    triggerClick()

    expect(values(emitted, 'FCP')).toEqual([])
    expect(values(emitted, 'LCP')).toEqual([])

    settle(module)
    expect(values(emitted, 'FCP')).toEqual([300])
    expect(values(emitted, 'LCP')).toEqual([900])
    module.stop()
  })
})
