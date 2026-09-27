// mask 脱敏器单元测试（规格书第 11 章 mask.test.ts 断言矩阵）。
import { describe, expect, it } from 'vitest'
import {
  containsPii,
  maskLog,
  maskPiiText,
  maskStackUrlQuery,
  maskUrlQuery,
  nodeSelector,
  sanitizeSelector,
  truncateStack
} from '../../src/utils/mask'
import type { CustomLog, ErrorLog, NetworkLog } from '../../src/contracts/log'

describe('maskUrlQuery', () => {
  it('把非白名单 query 值替换为 [filtered]', () => {
    const out = maskUrlQuery('https://example.com/p?a=1&b=2', [])
    expect(out).toBe('https://example.com/p?a=[filtered]&b=[filtered]')
  })

  it('白名单 key 的值保留原样', () => {
    const out = maskUrlQuery('https://example.com/p?a=1&token=abc123', ['token'])
    expect(out).toBe('https://example.com/p?a=[filtered]&token=abc123')
  })

  it('不含 query 的 URL 原样保留 path', () => {
    expect(maskUrlQuery('https://example.com/path', [])).toBe('https://example.com/path')
  })

  it('hash 一并做 PII 兜底脱敏', () => {
    const out = maskUrlQuery('https://example.com/p?a=1#/u/13912345678', [])
    expect(out).toBe('https://example.com/p?a=[filtered]#/u/<phone>')
  })
})

describe('maskPiiText', () => {
  it('替换邮箱', () => {
    expect(maskPiiText('mail me a.b-c@example.co.cn ok')).toBe('mail me <email> ok')
  })

  it('替换手机号', () => {
    expect(maskPiiText('拨打 13912345678 试试')).toBe('拨打 <phone> 试试')
  })

  it('替换 18 位身份证', () => {
    expect(maskPiiText('证件 11010519491231002X 有效')).toBe('证件 <id> 有效')
  })

  it('不把普通数字当作手机号', () => {
    expect(containsPii('编号 123456789 长度不足')).toBe(false)
  })
})

describe('selector 脱敏', () => {
  it('nodeSelector 输出 tag:nth-child 且不含 id/class', () => {
    document.body.innerHTML =
      '<div id="app"><span class="secret">x</span><img src="b.png"></div>'
    const span = document.querySelector('span')
    const sel = nodeSelector(span)
    expect(sel).toMatch(/div:nth-child\(\d+\) > span:nth-child\(\d+\)$/)
    expect(sel).not.toContain('secret')
    expect(sel).not.toContain('#app')
  })

  it('sanitizeSelector 丢弃 id/class/data-* 并限制 4 层', () => {
    const raw = 'a#x > b.c1 > c[data-y="1"] > d.y > e.z > f.h'
    const out = sanitizeSelector(raw)
    expect(out).toBe('c > d > e > f')
    expect(out).not.toContain('x')
    expect(out).not.toContain('c1')
    expect(out).not.toContain('data-y')
  })
})

describe('truncateStack', () => {
  it('截断到默认帧数以内', () => {
    const stack = Array.from({ length: 30 }, (_, i) => `  at fn${i} (x.js:${i}:1)`).join('\n')
    const out = truncateStack(stack)
    expect(out.split('\n').length).toBe(10)
  })
})

describe('maskStackUrlQuery', () => {
  it('堆栈帧内 URL 的 query 被脱敏且保留行号', () => {
    const stack =
      'Error: render crash\n    at crash (http://localhost:3860/demo/store/index.html?traffic=organic&uid=10086:184:17)\n    at render (app.js:4:1)'
    const out = maskStackUrlQuery(stack, [])
    expect(out).not.toContain('organic')
    expect(out).not.toContain('10086')
    expect(out).toContain('traffic=[filtered]&uid=[filtered]:184:17')
  })

  it('白名单 key 的值保留', () => {
    const stack = '    at fn (http://x.test/p?token=abc&secret=1:10:1)'
    const out = maskStackUrlQuery(stack, ['token'])
    expect(out).toContain('token=abc')
    expect(out).toContain('secret=[filtered]')
  })
})

function makeBase() {
  return {
    appId: 'a',
    schemaVersion: 1,
    sdkVersion: '1.0.0',
    env: 'production' as const,
    timestamp: 1,
    timeOriginCorrected: 0,
    pageUrl: 'https://example.com/p',
    pagePath: '/p',
    navigationType: 'navigate' as const,
    ua: 'ua',
    sessionId: 's'
  }
}

describe('maskLog', () => {
  it('对 network 日志的 reqUrl 做 query 脱敏', () => {
    const log: NetworkLog = {
      ...makeBase(),
      type: 'network',
      pageUrl: 'https://example.com/p?secret=1',
      data: {
        reqUrl: 'https://api.example.com/x?token=abc&a=1',
        reqMethod: 'GET',
        reqStartTime: 0,
        reqDuration: 10,
        resOk: true,
        aborted: false
      }
    }
    const out = maskLog(log, ['token'])
    expect(out.data.reqUrl).toBe('https://api.example.com/x?token=abc&a=[filtered]')
    expect(out.pageUrl).toBe('https://example.com/p?secret=[filtered]')
  })

  it('对 error 日志的 fileName（完整脚本 URL）做 query 脱敏', () => {
    const log: ErrorLog = {
      ...makeBase(),
      type: 'error',
      data: {
        errorType: 'js_error',
        message: 'boom',
        fileName: 'http://localhost:3860/app/index.html?traffic=organic&uid=10086',
        lineNo: 184,
        colNo: 17,
        count: 1,
        firstSeen: 1,
        lastSeen: 1
      }
    }
    const out = maskLog(log, [])
    expect(out.data.fileName).toBe(
      'http://localhost:3860/app/index.html?traffic=[filtered]&uid=[filtered]'
    )
  })

  it('对 custom 日志的字符串做 PII 兜底', () => {
    const log: CustomLog = {
      ...makeBase(),
      type: 'custom',
      data: { note: 'email: foo@bar.com' }
    }
    const out = maskLog(log, [])
    expect(out.data.note).toBe('email: <email>')
  })
})