// 传输层测试（规格书第 11 章 core.transport.test.ts 断言矩阵）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Transport } from '../../src/core/transport'
import { resolveConfig } from '../../src/core/config'
import type { RuntimeCounters } from '../../src/core/pipeline'
import type { CustomLog } from '../../src/contracts/log'

function makeLog(message = 'x'): CustomLog {
  return {
    appId: 'a',
    type: 'custom',
    schemaVersion: 1,
    sdkVersion: '1.0.0',
    env: 'production',
    timestamp: 1,
    timeOriginCorrected: 0,
    pageUrl: 'https://example.com/',
    pagePath: '/',
    navigationType: 'navigate',
    ua: 'ua',
    sessionId: 's',
    data: { message }
  }
}

function makeTransport(requestOverrides: Record<string, unknown> = {}) {
  const config = resolveConfig({
    appId: 'a',
    reportUrl: 'https://report.example.com/u',
    requestConfig: { headers: { 'X-Token': 'abc' }, timeout: 1000 },
    ...requestOverrides
  })
  const counters: RuntimeCounters = { sampledOut: 0, dropped: 0, failed: 0 }
  return { config, counters, transport: new Transport(config, counters, () => 'https://example.com/p?secret=1') }
}

describe('Transport', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('常规上报：2xx 返回 true，body 含固定顶层结构且 pageUrl 已脱敏', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    const { transport } = makeTransport()

    const ok = await transport.send([makeLog()])
    expect(ok).toBe(true)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://report.example.com/u')
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers['X-Token']).toBe('abc')
    const payload = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(payload.appId).toBe('a')
    expect(payload.schemaVersion).toBe(1)
    expect(payload.pageUrl).toBe('https://example.com/p?secret=[filtered]')
    expect(Array.isArray(payload.samples)).toBe(true)
  })

  it('非 2xx 与网络异常均返回 false', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    const { transport } = makeTransport()
    expect(await transport.send([makeLog()])).toBe(false)

    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('network down'))
    )
    expect(await transport.send([makeLog()])).toBe(false)
  })

  it('卸载上报：body ≤ 60KB 走 fetch keepalive', () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    const { transport } = makeTransport()

    const result = transport.sendUnload([makeLog('small')])
    expect(result).toBe('sent')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(init.keepalive).toBe(true)
  })

  it('卸载上报：body > 60KB 走 sendBeacon 降级且不带自定义 header', () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    const beaconMock = vi.fn().mockReturnValue(true)
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('navigator', { ...navigator, sendBeacon: beaconMock })

    const { transport } = makeTransport()
    const result = transport.sendUnload([makeLog('y'.repeat(70000))])
    expect(result).toBe('sent')
    expect(fetchMock).not.toHaveBeenCalled() // 超过上限不走 keepalive
    expect(beaconMock).toHaveBeenCalledTimes(1)
    const [url, blob] = beaconMock.mock.calls[0] as [string, Blob]
    expect(url).toBe('https://report.example.com/u')
    expect(blob.type).toBe('application/json')
    // sendBeacon 仅两个参数：无任何 header 参数可携带
    expect(beaconMock.mock.calls[0]).toHaveLength(2)
  })

  it('卸载上报：keepalive 与 sendBeacon 均不可用时计入 dropped', () => {
    vi.stubGlobal('fetch', undefined)
    const nav = { ...navigator }
    Object.defineProperty(nav, 'sendBeacon', { value: undefined })
    vi.stubGlobal('navigator', nav)

    const { transport, counters } = makeTransport()
    expect(transport.sendUnload([makeLog()])).toBe('dropped')
    expect(counters.dropped).toBe(1)
  })

  it('自定义 request：完全替换常规逻辑；未提供 unloadRequest 时卸载跳过并计入 dropped', async () => {
    const request = vi.fn().mockResolvedValue(undefined)
    const { transport, counters } = makeTransport({ request })
    expect(await transport.send([makeLog()])).toBe(true)
    expect(request).toHaveBeenCalledTimes(1)

    expect(transport.sendUnload([makeLog()])).toBe('dropped')
    expect(counters.dropped).toBe(1)

    const unloadRequest = vi.fn()
    const { transport: t2 } = makeTransport({ request, unloadRequest })
    expect(t2.sendUnload([makeLog()])).toBe('sent')
    expect(unloadRequest).toHaveBeenCalledTimes(1)

    const failing = vi.fn().mockRejectedValue(new Error('boom'))
    const { transport: t3 } = makeTransport({ request: failing })
    expect(await t3.send([makeLog()])).toBe(false)
  })
})