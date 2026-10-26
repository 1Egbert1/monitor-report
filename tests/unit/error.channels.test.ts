// 错误通道测试（规格书第 11 章 error.channels.test.ts 断言矩阵）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerErrorChannels } from '../../src/modules/error/channels'
import type { RawErrorData } from '../../src/modules/error/normalize'

describe('registerErrorChannels', () => {
  let captured: RawErrorData[] = []
  let off: () => void = () => undefined

  afterEach(() => {
    off()
    captured = []
    vi.restoreAllMocks()
  })

  function register(): void {
    off = registerErrorChannels({ onError: (data) => captured.push(data) })
  }

  it('同步 JS 错误通道产出 errorType=js_error，且 window.onerror 保持 null', () => {
    register()
    const err = new Error('boom')
    window.dispatchEvent(
      new ErrorEvent('error', {
        message: 'boom',
        error: err,
        filename: 'app.js',
        lineno: 3,
        colno: 7
      })
    )
    expect(captured.length).toBe(1)
    expect(captured[0]?.errorType).toBe('js_error')
    expect(captured[0]?.message).toBe('boom')
    expect(captured[0]?.fileName).toBe('app.js')
    expect(captured[0]?.lineNo).toBe(3)
    expect(window.onerror).toBeNull()
  })

  it('资源错误在 capture 阶段被捕获，errorType=resource_error', () => {
    register()
    const img = document.createElement('img')
    img.src = 'https://cdn.example.com/x.png'
    document.body.appendChild(img)

    const ev = new Event('error', { bubbles: false })
    const res = img.dispatchEvent(ev)
    expect(res).toBe(true)
    expect(captured.length).toBe(1)
    expect(captured[0]?.errorType).toBe('resource_error')
    expect(captured[0]?.resourceUrl).toBe('https://cdn.example.com/x.png')
    expect(captured[0]?.resourceType).toBe('img')
    expect(captured[0]?.selector).toContain('img:nth-child')
    img.remove()
  })

  it('JS 错误不冒泡到 capture 通道（target=window 被排除）', () => {
    register()
    window.dispatchEvent(new ErrorEvent('error', { message: 'plain', error: new Error('plain') }))
    expect(captured.filter((c) => c.errorType === 'resource_error').length).toBe(0)
    expect(captured.length).toBe(1)
  })

  it('非资源标签的 error 事件不进资源通道（白名单拦截）', () => {
    register()
    const div = document.createElement('div')
    document.body.appendChild(div)
    div.dispatchEvent(new Event('error'))
    expect(captured.length).toBe(0)
    div.remove()
  })

  it('自定义元素手动派发 error 不被误判为资源错误', () => {
    register()
    const custom = document.createElement('my-widget')
    document.body.appendChild(custom)
    custom.dispatchEvent(new Event('error'))
    expect(captured.length).toBe(0)
    custom.remove()
  })

  it('白名单内的 script 标签正常上报，resourceType 为小写标签名', () => {
    register()
    // 不设 src：避免 happy-dom 真的发起请求，导致额外产生一次失败事件
    const script = document.createElement('script')
    document.body.appendChild(script)
    script.dispatchEvent(new Event('error'))
    expect(captured.length).toBe(1)
    expect(captured[0]?.errorType).toBe('resource_error')
    expect(captured[0]?.resourceType).toBe('script')
    script.remove()
  })

  it('Promise 未处理拒绝通道产出 errorType=promise_error', () => {
    register()
    const ev = new Event('unhandledrejection')
    Object.defineProperty(ev, 'promise', { value: {} })
    Object.defineProperty(ev, 'reason', { value: new Error('async boom') })
    window.dispatchEvent(ev)
    expect(captured.length).toBe(1)
    expect(captured[0]?.errorType).toBe('promise_error')
    expect(captured[0]?.message).toBe('async boom')
  })

  it('rejectionhandled 打标后同一 Promise 不再上报', () => {
    register()
    const promise = {}
    const handled = new Event('rejectionhandled')
    Object.defineProperty(handled, 'promise', { value: promise })
    window.dispatchEvent(handled)

    const unhandled = new Event('unhandledrejection')
    Object.defineProperty(unhandled, 'promise', { value: promise })
    Object.defineProperty(unhandled, 'reason', { value: 'late' })
    window.dispatchEvent(unhandled)
    expect(captured.length).toBe(0)
  })

  it('解绑后各通道不再上报', () => {
    register()
    off()
    window.dispatchEvent(new ErrorEvent('error', { message: 'x', error: new Error('x') }))
    expect(captured.length).toBe(0)
  })
})