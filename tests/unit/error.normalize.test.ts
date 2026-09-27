// 错误归一化与指纹测试（规格书第 11 章 error.normalize.test.ts 断言矩阵）。
import { describe, expect, it } from 'vitest'
import {
  basenameWithoutHash,
  fingerprint,
  normalizeMessage,
  topFrameFnName
} from '../../src/modules/error/normalize'

describe('normalizeMessage', () => {
  it('按序替换 UUID / 长 hex / URL / 数字 / 引号内容', () => {
    const out = normalizeMessage(
      "id 550e8400-e29b-41d4-a716-446655440000 hex deadbeefdeadbeef url https://x.com/a?b=1 num 123 'quoted'"
    )
    expect(out).toContain('<uuid>')
    expect(out).toContain('<hex>')
    expect(out).toContain('<url>')
    expect(out).toContain('<n>')
    expect(out).toContain('<str>')
    expect(out).not.toMatch(/[0-9]/)
  })

  it('截断到 300 字符', () => {
    expect(normalizeMessage('x'.repeat(500)).length).toBe(300)
  })
})

describe('fingerprint', () => {
  it('含不同 UUID/数字/URL 的同构消息指纹一致', () => {
    const a = fingerprint({
      errorType: 'js_error',
      message: 'fail 550e8400-e29b-41d4-a716-446655440000 at https://x.com/1 err 999',
      fileName: 'app.abc123.js',
      stack: 'Error: x\n  at foo (app.js:1:1)',
      crossOrigin: false
    })
    const b = fingerprint({
      errorType: 'js_error',
      message: 'fail 12345678-1234-1234-1234-123456789012 at https://x.com/2 err 123',
      fileName: 'app.def456.js',
      stack: 'Error: x\n  at foo (app.js:1:1)',
      crossOrigin: false
    })
    expect(a).toBe(b)
  })

  it('不同 fileName 指纹不同', () => {
    const base = {
      errorType: 'js_error' as const,
      message: 'boom',
      crossOrigin: false
    }
    expect(fingerprint({ ...base, fileName: 'a.js' })).not.toBe(
      fingerprint({ ...base, fileName: 'b.js' })
    )
  })

  it("'Script error.' 的指纹包含跨域标记（crossOrigin 参与指纹）", () => {
    const part = {
      errorType: 'js_error' as const,
      message: 'Script error.',
      fileName: 'unknown-cross-origin'
    }
    expect(fingerprint({ ...part, crossOrigin: true })).not.toBe(
      fingerprint({ ...part, crossOrigin: false })
    )
  })
})

describe('basenameWithoutHash / topFrameFnName', () => {
  it('剥离 query/hash 与构建 hash', () => {
    expect(basenameWithoutHash('/assets/app.abc123.js?v=1#x')).toBe('app.js')
    expect(basenameWithoutHash('/assets/main.js')).toBe('main.js')
  })

  it('取堆栈首帧函数名（不含行列号）', () => {
    expect(topFrameFnName('Error: x\n    at render (main.js:10:5)\n    at App (x)')).toBe('render')
    expect(topFrameFnName('render@main.js:10:5')).toBe('render')
  })
})