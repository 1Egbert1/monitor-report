// 像素信标（image）上报模式测试：
// 1. transport: 'image' 时不走 fetch，通过 Image.src 发 GET；
// 2. URL 带编码后的 payload，图片尺寸为 1×1；
// 3. URL 超长直接判失败并计入 dropped（避免被代理截断后服务端解析失败）；
// 4. 默认仍是 fetch，不受影响。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Transport } from '../../src/core/transport'
import { resolveConfig } from '../../src/core/config'
import { IMAGE_MAX_URL_BYTES } from '../../src/constants/defaults'
import type { ReportLog } from '../../src/contracts/log'

/** 记录被创建的 Image 实例（用于断言 src / 尺寸）。 */
const created: MockImage[] = []

class MockImage {
  width = 0
  height = 0
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  private value = ''

  constructor() {
    created.push(this)
  }

  get src(): string {
    return this.value
  }

  set src(v: string) {
    this.value = v
  }
}

function makeCounters(): { sampledOut: number; dropped: number; failed: number } {
  return { sampledOut: 0, dropped: 0, failed: 0 }
}

function makeContext() {
  return {
    deviceInfo: { ua: 'ua' },
    pageInfo: {
      url: 'https://x.com/p',
      path: '/p',
      navigationType: 'navigate' as const
    },
    sessionInfo: { sessionId: 's' }
  }
}

function makeLog(message: string): ReportLog {
  return {
    type: 'custom',
    timestamp: 1,
    level: 'info',
    data: { message }
  } as unknown as ReportLog
}

function makeErrorLog(message: string, stack: string): ReportLog {
  return {
    type: 'error',
    timestamp: 1,
    level: 'error',
    data: { stack, message }
  } as unknown as ReportLog
}

/** 取出某个 img 请求里携带的 payload。 */
function logsOf(img: MockImage): { logs: Array<{ data: { stack?: string } }> } {
  return JSON.parse(decodeURIComponent(img.src.split('d=')[1] ?? ''))
}

describe('Transport · image 模式', () => {
  afterEach(() => {
    created.length = 0
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('通过 Image.src 发 GET，并带上编码后的 payload', async () => {
    vi.stubGlobal('Image', MockImage)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const config = resolveConfig({
      appId: 'a',
      reportUrl: 'https://r.example.com/u',
      transport: 'image'
    })
    const t = new Transport(config, makeCounters(), () => makeContext())

    const ok = await t.send([makeLog('hello')])

    expect(ok).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled() // 不走 fetch
    expect(created).toHaveLength(1)
    const img = created[0] as MockImage
    expect(img.width).toBe(1)
    expect(img.height).toBe(1)
    expect(img.src).toContain('https://r.example.com/u?d=')
    expect(decodeURIComponent(img.src.split('d=')[1] ?? '')).toContain('hello')
  })

  it('reportUrl 已有 query 时用 & 拼接', async () => {
    vi.stubGlobal('Image', MockImage)
    const config = resolveConfig({
      appId: 'a',
      reportUrl: 'https://r.example.com/u?tk=1',
      transport: 'image'
    })
    const t = new Transport(config, makeCounters(), () => makeContext())
    await t.send([makeLog('hi')])
    expect((created[0] as MockImage).src).toContain('?tk=1&d=')
  })

  it('URL 超长时判失败并计入 dropped（不发出会被截断的请求）', async () => {
    vi.stubGlobal('Image', MockImage)
    const config = resolveConfig({
      appId: 'a',
      reportUrl: 'https://r.example.com/u',
      transport: 'image'
    })
    const counters = makeCounters()
    const t = new Transport(config, counters, () => makeContext())

    const ok = await t.send([makeLog('x'.repeat(IMAGE_MAX_URL_BYTES))])

    expect(ok).toBe(false)
    expect(created).toHaveLength(0)
    expect(counters.dropped).toBe(1)
  })

  it('多条超长时拆成多个请求，每批都是可独立解析的完整数据', async () => {
    vi.stubGlobal('Image', MockImage)
    const config = resolveConfig({
      appId: 'a',
      reportUrl: 'https://r.example.com/u',
      transport: 'image'
    })
    const t = new Transport(config, makeCounters(), () => makeContext())

    // 每条约 600 字符，3 条加编码膨胀后必然超 2000 → 应拆成多个请求
    const logs = Array.from({ length: 3 }, (_, i) => makeLog('y'.repeat(600) + i))
    const ok = await t.send(logs)

    expect(ok).toBe(true)
    expect(created.length).toBeGreaterThan(1)
    // 关键：每个请求都是完整 JSON，服务端不需要任何重组逻辑
    const total = created.reduce((sum, img) => sum + logsOf(img).logs.length, 0)
    expect(total).toBe(3)
    for (const img of created) {
      expect(Array.isArray(logsOf(img).logs)).toBe(true)
      expect(img.src.length).toBeLessThanOrEqual(IMAGE_MAX_URL_BYTES)
    }
  })

  it('单条超长时截断 stack 而非丢弃整条', async () => {
    vi.stubGlobal('Image', MockImage)
    const config = resolveConfig({
      appId: 'a',
      reportUrl: 'https://r.example.com/u',
      transport: 'image'
    })
    const t = new Transport(config, makeCounters(), () => makeContext())

    const ok = await t.send([makeErrorLog('boom', 'z'.repeat(5000))])

    expect(ok).toBe(true)
    expect(created).toHaveLength(1)
    const stack = logsOf(created[0] as MockImage).logs[0]?.data.stack
    expect(stack?.length).toBe(500) // IMAGE_STACK_MAX_CHARS
  })

  it('默认 transport 仍是 fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    const config = resolveConfig({ appId: 'a', reportUrl: 'https://r.example.com/u' })
    const t = new Transport(config, makeCounters(), () => makeContext())

    const ok = await t.send([makeLog('x')])

    expect(ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(created).toHaveLength(0)
  })
})
