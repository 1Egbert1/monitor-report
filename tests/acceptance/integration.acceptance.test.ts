// 验收用例（规格书第 12 章）· 集成部分：AC-05 / AC-06 / AC-11 / AC-12 / AC-14。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMonitor } from '../../src/index'
import { MockPerformanceObserver, setVisibilityState } from '../setup'
import { vueErrorPlugin } from '../../src/plugins/vue3'
import type { LogReport } from '../../src/core/LogReport'
import type { ErrorData, NetworkData, PerformanceData, ReportLog } from '../../src/contracts/log'

/** 捕获上报体的 fetch mock。 */
function makeFetchCapture() {
  const bodies: Array<Record<string, unknown>> = []
  const fetchMock = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
    try {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
    } catch {
      // 非 JSON 请求忽略
    }
    return Promise.resolve({ ok: true })
  })
  return { bodies, fetchMock }
}

function logsOf(body: Record<string, unknown> | undefined): ReportLog[] {
  return (body?.logs as ReportLog[]) ?? []
}

describe('性能终态集成（AC-05 / AC-06）', () => {
  let monitor: LogReport
  let capture: ReturnType<typeof makeFetchCapture>

  beforeEach(() => {
    delete window.__MONITOR_REPORT__
    MockPerformanceObserver.reset()
    capture = makeFetchCapture()
    vi.stubGlobal('fetch', capture.fetchMock)
    monitor = createMonitor({
      appId: 'a',
      reportUrl: 'https://report.example.com/u',
      modules: ['performance'],
      debounceTime: 60_000
    })
  })

  afterEach(() => {
    monitor.destroy()
    setVisibilityState('visible')
    // 不调用 unstubAllGlobals：避免抹掉 setup.ts 注入的 PerformanceObserver 全局 mock，
    // 否则同文件后续用例的实例计数会被清零（fetch 由 beforeEach 每次重新 stub）。
  })

  function lastBody(): Record<string, unknown> {
    const call = capture.fetchMock.mock.calls[capture.fetchMock.mock.calls.length - 1]
    try {
      return JSON.parse(String((call?.[1] as RequestInit | undefined)?.body)) as Record<
        string,
        unknown
      >
    } catch {
      return {}
    }
  }

  it('AC-05 LCP 取终值而非首值', () => {
    MockPerformanceObserver.trigger('largest-contentful-paint', [
      { startTime: 100 },
      { startTime: 320 },
      { startTime: 250 }
    ])
    setVisibilityState('hidden')
    document.dispatchEvent(new Event('visibilitychange'))

    const lcp = logsOf(lastBody()).find(
      (s) => s.type === 'performance' && (s.data as PerformanceData).metricName === 'LCP'
    )
    expect(lcp).toBeDefined()
    expect((lcp?.data as PerformanceData).value).toBe(320)
  })

  it('AC-06 CLS = 0.05 仍上报', () => {
    MockPerformanceObserver.trigger('layout-shift', [
      { value: 0.05, hadRecentInput: false, startTime: 10, sources: [] }
    ])
    setVisibilityState('hidden')
    document.dispatchEvent(new Event('visibilitychange'))

    const cls = logsOf(lastBody()).find(
      (s) => s.type === 'performance' && (s.data as PerformanceData).metricName === 'CLS'
    )
    expect(cls).toBeDefined()
    expect((cls?.data as PerformanceData).value).toBeCloseTo(0.05, 4)
  })
})

describe('上报体脱敏与透传（AC-11 / AC-12）', () => {
  let monitor: LogReport | null = null

  beforeEach(() => {
    delete window.__MONITOR_REPORT__
  })

  afterEach(() => {
    monitor?.destroy()
    monitor = null
    vi.unstubAllGlobals()
  })

  it('AC-11 上报体中不含原始 query 值', async () => {
    window.history.pushState({}, '', '/p?secret=abc123&token=keepme')
    const { bodies, fetchMock } = makeFetchCapture()
    vi.stubGlobal('fetch', fetchMock)

    monitor = createMonitor({
      appId: 'a',
      reportUrl: 'https://report.example.com/u',
      modules: ['network'],
      maskQueryKeys: ['token'],
      debounceTime: 100
    })
    monitor.addReport('network', {
      reqUrl: 'https://api.example.com/x?password=hunter2&token=keepme',
      reqMethod: 'GET',
      reqStartTime: 0,
      reqDuration: 10,
      resOk: true,
      aborted: false
    })
    monitor.flushReport()
    await Promise.resolve()
    await Promise.resolve()

    const body = bodies[0]
    expect(body).toBeDefined()
    if (!body) return
    const raw = JSON.stringify(body)
    expect(raw).not.toContain('abc123')
    expect(raw).not.toContain('hunter2')
    const netSample = (body.logs as ReportLog[])[0] as { data: NetworkData }
    expect(netSample.data.reqUrl).toContain('token=keepme')
    expect(netSample.data.reqUrl).toContain('password=[filtered]')
  })

  it('AC-12 fetch 包装不破坏调用方（identity + 透传）', async () => {
    const fakeRes = { ok: true, status: 200 } as Response
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeRes))

    monitor = createMonitor({
      appId: 'a',
      reportUrl: 'https://report.example.com/u',
      modules: ['network']
    })
    const res = await window.fetch('https://api.example.com/data', { method: 'POST' })
    expect(res).toBe(fakeRes)
  })
})

describe('Vue 插件集成（AC-14）', () => {
  it('原有 handler 被保留调用且产出 vue_error 日志', async () => {
    delete window.__MONITOR_REPORT__
    const { bodies, fetchMock } = makeFetchCapture()
    vi.stubGlobal('fetch', fetchMock)
    const monitor = createMonitor({
      appId: 'a',
      reportUrl: 'https://report.example.com/u',
      modules: ['error'],
      debounceTime: 100
    })
    const prev = vi.fn()
    const app: {
      config: { errorHandler?: ((err: unknown, instance: unknown, info: string) => void) | null }
    } = { config: { errorHandler: prev } }
    vueErrorPlugin.install(app, { monitor })

    const err = new Error('vue ac14')
    const handler = app.config.errorHandler
    if (handler) handler(err, null, 'render')
    expect(prev).toHaveBeenCalledTimes(1)

    monitor.flushReport()
    await Promise.resolve()
    await Promise.resolve()
    const body = bodies[0]
    const errLog = logsOf(body).find((s) => s.type === 'error')
    expect(errLog).toBeDefined()
    expect((errLog?.data as ErrorData | undefined)?.errorType).toBe('vue_error')
    monitor.destroy()
    vi.unstubAllGlobals()
  })
})