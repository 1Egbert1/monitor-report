// 错误去重（计数聚合）测试（规格书第 11 章 error.dedup.test.ts 断言矩阵）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createErrorMonitor } from '../../src/modules/error'
import { resolveConfig } from '../../src/core/config'
import type { ModuleContext } from '../../src/contracts/emitter'
import type { ErrorData } from '../../src/contracts/log'

const T0 = 1700000000000

function dispatchJsError(message: string): void {
  window.dispatchEvent(
    new ErrorEvent('error', { message, error: new Error(message), filename: 'app.js' })
  )
}

describe('ErrorMonitor 计数式去重', () => {
  let emitted: ErrorData[]
  let module: ReturnType<typeof createErrorMonitor>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    emitted = []
    const teardowns: Array<() => void> = []
    const config = resolveConfig({
      appId: 'a',
      reportUrl: 'https://r.example.com/u',
      dedupWindow: 5000
    })
    const ctx = {
      config,
      emitter: { emit: (type: string, data: ErrorData) => emitted.push(data) },
      onTeardown: (fn: () => void) => teardowns.push(fn),
      isPageHidden: () => document.visibilityState === 'hidden',
      now: () => Date.now()
    } as unknown as ModuleContext
    module = createErrorMonitor()
    module.start(ctx)
  })

  afterEach(() => {
    module.stop()
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true
    })
    vi.useRealTimers()
  })

  it('5s 内同指纹只 emit 一次且 count === n', async () => {
    dispatchJsError('same fingerprint error')
    dispatchJsError('same fingerprint error')
    dispatchJsError('same fingerprint error')
    expect(emitted.length).toBe(0)

    await vi.advanceTimersByTimeAsync(10000) // 定时器 tick 5000/10000，超过窗口后统一 emit
    expect(emitted.length).toBe(1)
    expect(emitted[0]?.count).toBe(3)
  })

  it('窗口到期后 emit 且 firstSeen < lastSeen', async () => {
    dispatchJsError('windowed error')
    vi.setSystemTime(T0 + 200)
    dispatchJsError('windowed error') // 命中同指纹，仅更新 lastSeen

    await vi.advanceTimersByTimeAsync(10000)
    expect(emitted.length).toBe(1)
    const data = emitted[0]
    if (!data) return
    expect(data.count).toBe(2)
    expect(data.firstSeen).toBeLessThan(data.lastSeen)
    expect(data.lastSeen - data.firstSeen).toBe(200)
  })

  it('页面隐藏（onPageHidden 钩子）时立即 flush 全部聚合条目', () => {
    dispatchJsError('hidden flush')
    expect(emitted.length).toBe(0)

    ;(module as unknown as { onPageHidden?: () => void }).onPageHidden?.()
    expect(emitted.length).toBe(1)
    expect(emitted[0]?.count).toBe(1)
  })

  it('stop() 后解绑通道，不再产生聚合', () => {
    module.stop()
    dispatchJsError('after stop')
    expect(emitted.length).toBe(0)
  })
})