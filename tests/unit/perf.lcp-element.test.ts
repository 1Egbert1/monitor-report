// LCP 元素定位测试：上报时携带最大内容元素的选择器，用于排查「是哪个元素慢」。
import { beforeEach, describe, expect, it } from 'vitest'
import { createPerformanceMonitor } from '../../src/modules/performance'
import { makeModuleCtx } from '../helpers'
import { MockPerformanceObserver } from '../setup'
import type { PerformanceData } from '../../src/contracts/log'

/** 取出已上报的 LCP 数据。 */
function lcpData(
  emitted: ReturnType<typeof makeModuleCtx>['emitted']
): PerformanceData | undefined {
  return emitted
    .filter((e) => e.type === 'performance')
    .map((e) => e.data as PerformanceData)
    .find((d) => d.metricName === 'LCP')
}

/** 触发一次隐藏结算（必须保持方法调用形式，否则 this 丢失）。 */
function settle(module: ReturnType<typeof createPerformanceMonitor>): void {
  const target = module as unknown as { onPageHidden?: () => void }
  target.onPageHidden?.()
}

describe('LCP 元素定位', () => {
  beforeEach(() => {
    MockPerformanceObserver.reset()
    document.body.innerHTML = ''
  })

  it('上报 lcpElement 为最大内容元素的结构选择器', () => {
    const { ctx, emitted } = makeModuleCtx()
    const module = createPerformanceMonitor()
    module.start(ctx)

    const box = document.createElement('div')
    const img = document.createElement('img')
    box.appendChild(img)
    document.body.appendChild(box)

    MockPerformanceObserver.trigger('largest-contentful-paint', [
      { startTime: 1800, element: img }
    ])
    settle(module)

    const data = lcpData(emitted)
    expect(data?.value).toBe(1800)
    expect(data?.lcpElement).toContain('img:nth-child(')
    module.stop()
  })

  it('元素选择器取自最大候选，而不是首个候选', () => {
    const { ctx, emitted } = makeModuleCtx()
    const module = createPerformanceMonitor()
    module.start(ctx)

    const small = document.createElement('img')
    const large = document.createElement('h1')
    document.body.appendChild(small)
    document.body.appendChild(large)

    MockPerformanceObserver.trigger('largest-contentful-paint', [
      { startTime: 800, element: small }
    ])
    MockPerformanceObserver.trigger('largest-contentful-paint', [
      { startTime: 2400, element: large }
    ])
    settle(module)

    const data = lcpData(emitted)
    expect(data?.value).toBe(2400)
    expect(data?.lcpElement).toContain('h1:nth-child(')
    expect(data?.lcpElement).not.toContain('img:')
    module.stop()
  })

  it('浏览器未提供 element 时 lcpElement 为 undefined', () => {
    const { ctx, emitted } = makeModuleCtx()
    const module = createPerformanceMonitor()
    module.start(ctx)

    // bfcache 重放等场景，entry 上可能没有 element
    MockPerformanceObserver.trigger('largest-contentful-paint', [{ startTime: 1500 }])
    settle(module)

    const data = lcpData(emitted)
    expect(data?.value).toBe(1500)
    expect(data?.lcpElement).toBeUndefined()
    module.stop()
  })
})
