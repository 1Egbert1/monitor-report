// 内存模块测试（规格书 T-10：兼容降级与增长阈值用例）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryMonitor } from '../../src/modules/memory'
import { makeModuleCtx } from '../helpers'
import type { MemoryData } from '../../src/contracts/log'

/** 设置 performance.memory，返回恢复函数。 */
function stubMemory(value: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } | undefined): () => void {
  if (value === undefined) {
    Object.defineProperty(performance, 'memory', { value: undefined, configurable: true })
  } else {
    Object.defineProperty(performance, 'memory', { value, configurable: true })
  }
  return () => {
    Object.defineProperty(performance, 'memory', { value: undefined, configurable: true })
  }
}

describe('MemoryMonitor', () => {
  let restoreMemory: () => void = () => undefined

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    restoreMemory()
    vi.useRealTimers()
  })

  function memoryLogs(emitted: ReturnType<typeof makeModuleCtx>['emitted']): MemoryData[] {
    return emitted.filter((e) => e.type === 'memory').map((e) => e.data as MemoryData)
  }

  it('performance.memory 不存在时静默禁用：不抛错、不上报、无定时器', () => {
    restoreMemory = stubMemory(undefined)
    const { ctx, emitted } = makeModuleCtx({
      memory: { interval: 100, reportOnlyOnGrowth: false }
    })
    const module = createMemoryMonitor()
    expect(() => module.start(ctx)).not.toThrow()
    expect(vi.getTimerCount()).toBe(0)
    expect(emitted.length).toBe(0)
    module.stop()
  })

  it('reportOnlyOnGrowth=false 时每次采样都上报（含 deltaBytes 与增长率）', async () => {
    restoreMemory = stubMemory({
      usedJSHeapSize: 1000,
      totalJSHeapSize: 2000,
      jsHeapSizeLimit: 4000
    })
    const { ctx, emitted } = makeModuleCtx({
      memory: { interval: 100, reportOnlyOnGrowth: false }
    })
    const module = createMemoryMonitor()
    module.start(ctx)

    await vi.advanceTimersByTimeAsync(100)
    await vi.advanceTimersByTimeAsync(100)
    const logs = memoryLogs(emitted)
    expect(logs.length).toBeGreaterThanOrEqual(2)
    expect(logs[0]?.deltaBytes).toBeNull() // 首样本无上一采样
    const second = logs[1]
    expect(second?.deltaBytes).toBe(0)
    expect(second?.usageRate).toBe(0.5)
    module.stop()
  })

  it('reportOnlyOnGrowth=true 时仅当增长达阈值才上报', async () => {
    const mem = { usedJSHeapSize: 1000, totalJSHeapSize: 20000, jsHeapSizeLimit: 40000 }
    restoreMemory = stubMemory(mem)
    const { ctx, emitted } = makeModuleCtx({
      memory: {
        interval: 100,
        reportOnlyOnGrowth: true,
        growthThresholdPerMinute: 60000 // 60KB/min
      }
    })
    const module = createMemoryMonitor()
    module.start(ctx)

    // 第一次 tick：仅 1 个样本（增长率 null）→ 不上报
    mem.usedJSHeapSize = 1001
    await vi.advanceTimersByTimeAsync(100)
    expect(memoryLogs(emitted).length).toBe(0)

    // 第二次 tick：增长 1B/100ms ≈ 600B/min < 阈值 → 不上报
    mem.usedJSHeapSize = 1002
    await vi.advanceTimersByTimeAsync(100)
    expect(memoryLogs(emitted).length).toBe(0)

    // 第三次 tick：增长 200B/100ms ≈ 120KB/min ≥ 阈值 → 上报
    mem.usedJSHeapSize = 1202
    await vi.advanceTimersByTimeAsync(100)
    const logs = memoryLogs(emitted)
    expect(logs.length).toBe(1)
    expect(logs[0]?.growthPerMinute).toBeGreaterThanOrEqual(60000)
    expect(logs[0]?.sampleIndex).toBe(3)
    module.stop()
  })

  it('后台标签页（hidden）跳过采样，不上报', async () => {
    restoreMemory = stubMemory({
      usedJSHeapSize: 1000,
      totalJSHeapSize: 2000,
      jsHeapSizeLimit: 4000
    })
    const { ctx, emitted } = makeModuleCtx({
      memory: { interval: 100, reportOnlyOnGrowth: false }
    })
    const module = createMemoryMonitor()
    module.start(ctx)

    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      configurable: true
    })
    await vi.advanceTimersByTimeAsync(500)
    expect(emitted.length).toBe(0)

    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true
    })
    await vi.advanceTimersByTimeAsync(100)
    expect(emitted.length).toBeGreaterThan(0)
    module.stop()
  })

  it('stop() 清理定时器并停止上报', async () => {
    restoreMemory = stubMemory({
      usedJSHeapSize: 1000,
      totalJSHeapSize: 2000,
      jsHeapSizeLimit: 4000
    })
    const { ctx, emitted } = makeModuleCtx({
      memory: { interval: 100, reportOnlyOnGrowth: false }
    })
    const module = createMemoryMonitor()
    module.start(ctx)
    module.stop()
    await vi.advanceTimersByTimeAsync(1000)
    expect(emitted.length).toBe(0)
  })
})