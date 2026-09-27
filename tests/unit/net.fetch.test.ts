// fetch 包装测试（规格书第 11 章 net.fetch.test.ts 断言矩阵）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { wrapFetch } from '../../src/modules/network/fetch'
import type { NetworkData } from '../../src/contracts/log'

function makeOriginalFetch(res: Response | Promise<Response>) {
  return vi.fn(() => (res instanceof Promise ? res : Promise.resolve(res)))
}

describe('wrapFetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function setup(resolve: Response | Promise<Response>, blacklist: string[] = []) {
    const original = makeOriginalFetch(resolve)
    vi.stubGlobal('fetch', original)
    const captured: NetworkData[] = []
    const unwrap = wrapFetch({
      onDone: (d) => captured.push(d),
      isBlacklisted: (url) => blacklist.some((b) => url.includes(b))
    })
    return { original, captured, unwrap }
  }

  it('返回值 === 原 Response（identity，不替换不包装）', async () => {
    const fakeRes = { ok: true, status: 200 } as Response
    const { unwrap } = setup(fakeRes)
    const res = await window.fetch('https://api.example.com/x')
    expect(res).toBe(fakeRes)
    unwrap()
  })

  it('Request 对象入参 URL 提取正确', async () => {
    const fakeRes = { ok: true, status: 200 } as Response
    const { captured, unwrap } = setup(fakeRes)
    await window.fetch(new Request('https://api.example.com/r?q=1'))
    expect(captured.length).toBe(1)
    expect(captured[0]?.reqUrl).toBe('https://api.example.com/r?q=1')
    expect(captured[0]?.reqMethod).toBe('GET')
    unwrap()
  })

  it('AbortError 记为 aborted 且不计为失败（resOk=true）', async () => {
    const { captured, unwrap } = setup(Promise.reject(Object.assign(new Error(), { name: 'AbortError' })))
    await expect(window.fetch('https://api.example.com/a')).rejects.toBeTruthy()
    expect(captured.length).toBe(1)
    expect(captured[0]?.aborted).toBe(true)
    expect(captured[0]?.resOk).toBe(true)
    expect(captured[0]?.errorMessage).toBeUndefined()
    unwrap()
  })

  it('其他异常记为失败：resOk=false 且带 errorMessage', async () => {
    const { captured, unwrap } = setup(Promise.reject(new TypeError('Failed to fetch')))
    await expect(window.fetch('https://api.example.com/f')).rejects.toBeTruthy()
    expect(captured[0]?.resOk).toBe(false)
    expect(captured[0]?.errorMessage).toBe('Failed to fetch')
    unwrap()
  })

  it('二次包裹不生效（__monitorWrapped 防多 SDK 递归）', async () => {
    const fakeRes = { ok: true, status: 200 } as Response
    const { captured, unwrap } = setup(fakeRes)
    const secondCaptured: NetworkData[] = []
    const unwrap2 = wrapFetch({
      onDone: (d) => secondCaptured.push(d),
      isBlacklisted: () => false
    })
    await window.fetch('https://api.example.com/x')
    expect(captured.length).toBe(1)
    expect(secondCaptured.length).toBe(0)
    unwrap2()
    unwrap()
  })

  it('黑名单请求不采集但原样透传', async () => {
    const fakeRes = { ok: true, status: 200 } as Response
    const { captured, unwrap } = setup(fakeRes, ['/report/'])
    const res = await window.fetch('https://api.example.com/report/u')
    expect(res).toBe(fakeRes)
    expect(captured.length).toBe(0)
    unwrap()
  })

  it('解绑后恢复原始 fetch', () => {
    const { original, unwrap } = setup({ ok: true, status: 200 } as Response)
    expect(window.fetch).not.toBe(original)
    unwrap()
    expect(window.fetch).toBe(original)
  })
})