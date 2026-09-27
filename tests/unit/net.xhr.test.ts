// XHR 包装测试（规格书第 11 章 net.xhr.test.ts 断言矩阵）。
// 用 FakeXhr 全局替换 XMLHttpRequest：避免 happy-dom 真实发起网络请求，且包装作用于受控原型。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { wrapXhr } from '../../src/modules/network/xhr'
import type { NetworkData } from '../../src/contracts/log'

/**
 * 受控 XHR 实现：事件手动触发，不发起真实请求。
 */
class FakeXhr {
  status = 0
  statusText = ''
  method = ''
  url = ''
  sentBody: unknown = null

  private listeners = new Map<string, Array<(ev: Event) => void>>()

  open(method: string, url: string | URL): void {
    this.method = method.toUpperCase()
    this.url = String(url)
  }

  send(body?: Document | XMLHttpRequestBodyInit | null): void {
    this.sentBody = body
  }

  addEventListener(type: string, fn: (ev: Event) => void): void {
    const list = this.listeners.get(type) ?? []
    list.push(fn)
    this.listeners.set(type, list)
  }

  removeEventListener(type: string, fn: (ev: Event) => void): void {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((f) => f !== fn)
    )
  }

  dispatchEvent(ev: Event): boolean {
    for (const fn of this.listeners.get(ev.type) ?? []) {
      fn(ev)
    }
    return true
  }
}

function newXhr(): FakeXhr {
  return new XMLHttpRequest() as unknown as FakeXhr
}

function fire(xhr: unknown, name: string): void {
  (xhr as { dispatchEvent(ev: Event): boolean }).dispatchEvent(new Event(name))
}

describe('wrapXhr', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function setup() {
    vi.stubGlobal('XMLHttpRequest', FakeXhr)
    const captured: NetworkData[] = []
    const unwrap = wrapXhr({
      onDone: (d) => captured.push(d),
      isBlacklisted: (url) => url.includes('/report/')
    })
    return { captured, unwrap }
  }

  it('实例上无自定义可枚举属性（元数据走 WeakMap）', () => {
    const { unwrap } = setup()
    const xhr = newXhr()
    xhr.open('GET', 'https://api.example.com/x')
    xhr.send(null)

    const suspicious = Object.keys(xhr).filter((k) => /meta|monitor/i.test(k))
    expect(suspicious).toEqual([])
    expect(Object.getOwnPropertyNames(xhr).filter((k) => /meta|monitor/i.test(k))).toEqual([])

    fire(xhr, 'loadend')
    unwrap()
  })

  it('method / url / 耗时被正确采集', () => {
    const { captured, unwrap } = setup()
    const xhr = newXhr()
    Object.defineProperty(xhr, 'status', { value: 200, configurable: true })
    xhr.open('post', 'https://api.example.com/data')
    xhr.send('b')
    fire(xhr, 'loadend')
    expect(captured.length).toBe(1)
    expect(captured[0]?.reqMethod).toBe('POST')
    expect(captured[0]?.reqUrl).toBe('https://api.example.com/data')
    expect(captured[0]?.resOk).toBe(true)
    expect(captured[0]?.resStatus).toBe(200)
    expect(captured[0]?.aborted).toBe(false)
    unwrap()
  })

  it('abort 正确分类：aborted=true 且不计失败', () => {
    const { captured, unwrap } = setup()
    const xhr = newXhr()
    Object.defineProperty(xhr, 'status', { value: 0, configurable: true })
    xhr.open('GET', 'https://api.example.com/a')
    xhr.send(null)
    fire(xhr, 'abort')
    fire(xhr, 'loadend')
    expect(captured.length).toBe(1)
    expect(captured[0]?.aborted).toBe(true)
    expect(captured[0]?.resOk).toBe(true)
    expect(captured[0]?.errorMessage).toBeUndefined()
    unwrap()
  })

  it('网络错误：resOk=false 且 errorMessage 标记', () => {
    const { captured, unwrap } = setup()
    const xhr = newXhr()
    Object.defineProperty(xhr, 'status', { value: 0, configurable: true })
    xhr.open('GET', 'https://api.example.com/e')
    xhr.send(null)
    fire(xhr, 'error')
    fire(xhr, 'loadend')
    expect(captured.length).toBe(1)
    expect(captured[0]?.resOk).toBe(false)
    expect(captured[0]?.errorMessage).toBe('network error')
    unwrap()
  })

  it('超时：resOk=false 且 errorMessage=timeout', () => {
    const { captured, unwrap } = setup()
    const xhr = newXhr()
    xhr.open('GET', 'https://api.example.com/t')
    xhr.send(null)
    fire(xhr, 'timeout')
    fire(xhr, 'loadend')
    expect(captured.length).toBe(1)
    expect(captured[0]?.resOk).toBe(false)
    expect(captured[0]?.errorMessage).toBe('timeout')
    unwrap()
  })

  it('黑名单请求不采集', () => {
    const { captured, unwrap } = setup()
    const xhr = newXhr()
    xhr.open('POST', 'https://api.example.com/report/u')
    xhr.send(null)
    fire(xhr, 'loadend')
    expect(captured.length).toBe(0)
    unwrap()
  })

  it('包装幂等：二次包裹不生效；解绑后恢复原型', () => {
    const first: NetworkData[] = []
    vi.stubGlobal('XMLHttpRequest', FakeXhr)
    const unwrap = wrapXhr({
      onDone: (d) => first.push(d),
      isBlacklisted: () => false
    })
    const second: NetworkData[] = []
    const unwrap2 = wrapXhr({
      onDone: (d) => second.push(d),
      isBlacklisted: () => false
    })

    const xhr = newXhr()
    Object.defineProperty(xhr, 'status', { value: 200, configurable: true })
    xhr.open('GET', 'https://api.example.com/ok')
    xhr.send(null)
    fire(xhr, 'loadend')
    expect(first.length).toBe(1)
    expect(second.length).toBe(0)

    unwrap2()
    unwrap()
    const xhr2 = newXhr()
    xhr2.open('GET', 'https://api.example.com/ok')
    xhr2.send(null)
    fire(xhr2, 'loadend')
    expect(first.length).toBe(1) // 解绑后不再采集
  })
})