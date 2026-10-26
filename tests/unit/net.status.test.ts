// 网络结果归类测试（规格书 7.3）：确保 400 / 401 / 403 / 404 / 5xx 不被统一成「接口异常」，
// 且 fetch 与 XHR 两条通道对同一状态码给出完全一致的 resOk。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { classifyNetworkOutcome } from '../../src/modules/network/status'
import { wrapXhr } from '../../src/modules/network/xhr'
import type { NetworkData } from '../../src/contracts/log'

describe('classifyNetworkOutcome', () => {
  it.each([
    [400, 'bad_request'],
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [405, 'client_error'],
    [418, 'client_error'],
    [429, 'client_error'],
    [500, 'server_error'],
    [502, 'server_error'],
    [504, 'server_error']
  ])('%i 归类为 %s 且计为失败', (status, category) => {
    const out = classifyNetworkOutcome({ resStatus: status, aborted: false })
    expect(out.statusCategory).toBe(category)
    expect(out.resOk).toBe(false)
    // 文案必须带上状态码，下游能直接看出是哪一类问题
    expect(out.statusMessage).toContain(String(status))
  })

  it('401 文案指向登录态与刷新逻辑', () => {
    expect(classifyNetworkOutcome({ resStatus: 401, aborted: false }).statusMessage).toContain('token')
  })

  it('404 文案指向 URL 与接口版本', () => {
    const msg = classifyNetworkOutcome({ resStatus: 404, aborted: false }).statusMessage
    expect(msg).toContain('URL')
    expect(msg).toContain('版本')
  })

  it('2xx 计为成功', () => {
    const out = classifyNetworkOutcome({ resStatus: 201, aborted: false })
    expect(out.resOk).toBe(true)
    expect(out.statusCategory).toBe('success')
  })

  it('未命中专用表的状态码走大类兜底', () => {
    expect(classifyNetworkOutcome({ resStatus: 499, aborted: false }).statusCategory).toBe(
      'client_error'
    )
    expect(classifyNetworkOutcome({ resStatus: 599, aborted: false }).statusCategory).toBe(
      'server_error'
    )
  })

  it('3xx 重定向未跟随视为未完成任务', () => {
    const out = classifyNetworkOutcome({ resStatus: 301, aborted: false })
    expect(out.resOk).toBe(false)
    expect(out.statusCategory).toBe('redirect')
  })

  it('304 协商缓存命中算成功且有独立文案', () => {
    const out = classifyNetworkOutcome({ resStatus: 304, aborted: false })
    expect(out.resOk).toBe(true)
    expect(out.statusMessage).toContain('协商缓存')
  })

  it('取消优先于状态码：status=0 也不记失败', () => {
    const out = classifyNetworkOutcome({ resStatus: 0, aborted: true })
    expect(out.resOk).toBe(true)
    expect(out.statusCategory).toBe('aborted')
  })

  it('超时与网络层失败分开归类', () => {
    expect(classifyNetworkOutcome({ aborted: false, timedOut: true }).statusCategory).toBe('timeout')
    expect(classifyNetworkOutcome({ aborted: false, errored: true }).statusCategory).toBe(
      'network_error'
    )
  })
})

describe('XHR 状态码判定（与 fetch 对齐）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** 受控 XHR：事件手动触发，不发起真实请求。 */
  class FakeXhr {
    status = 0
    statusText = ''
    private listeners = new Map<string, Array<(ev: Event) => void>>()

    open(..._args: unknown[]): void {
      // 由包装器调用，无需实现
    }

    send(..._args: unknown[]): void {
      // 由包装器调用，无需实现
    }

    addEventListener(type: string, fn: (ev: Event) => void): void {
      const list = this.listeners.get(type) ?? []
      list.push(fn)
      this.listeners.set(type, list)
    }

    dispatchEvent(ev: Event): boolean {
      for (const fn of this.listeners.get(ev.type) ?? []) {
        fn(ev)
      }
      return true
    }
  }

  /**
   * 构造一次完成的请求并返回采集结果。
   * @param status HTTP 状态码
   */
  function run(status: number): NetworkData {
    vi.stubGlobal('XMLHttpRequest', FakeXhr)
    const captured: NetworkData[] = []
    const unwrap = wrapXhr({
      onDone: (d) => captured.push(d),
      isBlacklisted: () => false
    })
    const xhr = new XMLHttpRequest() as unknown as FakeXhr & { dispatchEvent(e: Event): boolean }
    xhr.status = status
    xhr.open('GET', 'https://api.example.com/x')
    xhr.send()
    xhr.dispatchEvent(new Event('loadend'))
    unwrap()
    return captured[0] as NetworkData
  }

  it('404 必须计为失败（旧实现误判为成功）', () => {
    const d = run(404)
    expect(d.resOk).toBe(false)
    expect(d.statusCategory).toBe('not_found')
    expect(d.resStatus).toBe(404)
  })

  it('500 必须计为失败', () => {
    const d = run(500)
    expect(d.resOk).toBe(false)
    expect(d.statusCategory).toBe('server_error')
  })

  it('200 计为成功', () => {
    const d = run(200)
    expect(d.resOk).toBe(true)
    expect(d.statusCategory).toBe('success')
  })
})
