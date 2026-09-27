// 调度器测试（规格书第 11 章 core.scheduler.test.ts 断言矩阵）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Scheduler } from '../../src/core/scheduler'
import { ReportQueue } from '../../src/core/queue'
import type { Transport } from '../../src/core/transport'
import type { RuntimeCounters } from '../../src/core/pipeline'
import type { CustomLog, ReportLog } from '../../src/contracts/log'

function makeNotice(count: number): CustomLog {
  return {
    appId: 'a',
    type: 'custom',
    schemaVersion: 1,
    sdkVersion: '1.0.0',
    env: 'production',
    timestamp: 0,
    timeOriginCorrected: 0,
    pageUrl: 'https://example.com/',
    pagePath: '/',
    navigationType: 'navigate',
    ua: 'ua',
    sessionId: 's',
    data: { event: 'logs_dropped', count }
  }
}

function makeLog(id: number): ReportLog {
  return {
    appId: 'a',
    type: 'custom',
    schemaVersion: 1,
    sdkVersion: '1.0.0',
    env: 'production',
    timestamp: id,
    timeOriginCorrected: 0,
    pageUrl: 'https://example.com/',
    pagePath: '/',
    navigationType: 'navigate',
    ua: 'ua',
    sessionId: 's',
    data: { id }
  }
}

function makeTransport() {
  return {
    send: vi.fn(),
    sendUnload: vi.fn(),
    abort: vi.fn()
  } as unknown as Transport
}

describe('Scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('防抖批报：窗口内的多条日志合并为一次请求', async () => {
    const queue = new ReportQueue(300, makeNotice)
    const transport = makeTransport()
    const counters: RuntimeCounters = { sampledOut: 0, dropped: 0, failed: 0 }
    const s = new Scheduler({ queue, transport, counters, debounceTime: 1000 })
    vi.mocked(transport.send).mockResolvedValue(true)

    queue.add(makeLog(1))
    s.notifyAdded()
    queue.add(makeLog(2))
    s.notifyAdded()
    expect(transport.send).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1000)
    expect(transport.send).toHaveBeenCalledTimes(1)
    const batch = vi.mocked(transport.send).mock.calls[0]?.[0] ?? []
    expect(batch.length).toBe(2)
    s.dispose()
  })

  it('失败回塞保持顺序并指数退避（1s/2s）', async () => {
    const queue = new ReportQueue(300, makeNotice)
    const transport = makeTransport()
    const counters: RuntimeCounters = { sampledOut: 0, dropped: 0, failed: 0 }
    const s = new Scheduler({ queue, transport, counters, debounceTime: 1000 })
    vi.mocked(transport.send)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true)

    queue.add(makeLog(1))
    queue.add(makeLog(2))
    s.notifyAdded()

    await vi.advanceTimersByTimeAsync(1000) // 首次 flush 失败
    expect(transport.send).toHaveBeenCalledTimes(1)
    expect(queue.size).toBe(2) // 已回塞

    await vi.advanceTimersByTimeAsync(1000) // 1s 后退避重试，仍失败
    expect(transport.send).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(2000) // 2s 后重试成功
    expect(transport.send).toHaveBeenCalledTimes(3)
    const finalBatch = vi.mocked(transport.send).mock.calls[2]?.[0] ?? []
    expect((finalBatch as Array<ReportLog & { data: { id?: number } }>).map((l) => l.data.id)).toEqual([
      1, 2
    ])
    expect(counters.failed).toBe(0)
    s.dispose()
  })

  it('最多 3 次重试，之后放弃并计入 failed', async () => {
    const queue = new ReportQueue(300, makeNotice)
    const transport = makeTransport()
    const counters: RuntimeCounters = { sampledOut: 0, dropped: 0, failed: 0 }
    const s = new Scheduler({ queue, transport, counters, debounceTime: 1000 })
    vi.mocked(transport.send).mockResolvedValue(false)

    queue.add(makeLog(1))
    s.notifyAdded()

    await vi.advanceTimersByTimeAsync(1000) // 首次
    await vi.advanceTimersByTimeAsync(1000) // 重试 1
    await vi.advanceTimersByTimeAsync(2000) // 重试 2
    await vi.advanceTimersByTimeAsync(4000) // 重试 3
    expect(transport.send).toHaveBeenCalledTimes(4)
    expect(counters.failed).toBe(1)

    await vi.advanceTimersByTimeAsync(20000)
    expect(transport.send).toHaveBeenCalledTimes(4) // 不再重试
    s.dispose()
  })

  it('未注册 unload / beforeunload', () => {
    const winAdd = vi.spyOn(window, 'addEventListener')
    const docAdd = vi.spyOn(document, 'addEventListener')
    const queue = new ReportQueue(300, makeNotice)
    const s = new Scheduler({
      queue,
      transport: makeTransport(),
      counters: { sampledOut: 0, dropped: 0, failed: 0 },
      debounceTime: 1000
    })
    const events = [...winAdd.mock.calls.map((c) => c[0]), ...docAdd.mock.calls.map((c) => c[0])]
    expect(events).not.toContain('unload')
    expect(events).not.toContain('beforeunload')
    expect(events).toContain('visibilitychange')
    s.dispose()
  })

  it('页面隐藏触发卸载通道 flush', async () => {
    const queue = new ReportQueue(300, makeNotice)
    const transport = makeTransport()
    const s = new Scheduler({
      queue,
      transport,
      counters: { sampledOut: 0, dropped: 0, failed: 0 },
      debounceTime: 1000
    })
    queue.add(makeLog(1))
    s.notifyAdded()
    vi.mocked(transport.sendUnload).mockReturnValue('sent')

    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      configurable: true
    })
    document.dispatchEvent(new Event('visibilitychange'))
    await Promise.resolve()
    expect(transport.sendUnload).toHaveBeenCalledTimes(1)
    s.dispose()
  })
})