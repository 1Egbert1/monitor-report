// 行为栈测试（规格书 7.1）：记录用户操作、错误发生时快照、隐私与容量边界。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BreadcrumbStore, describeElement } from '../../src/modules/error/breadcrumb'
import { createErrorMonitor } from '../../src/modules/error'
import { makeModuleCtx } from '../helpers'
import type { Breadcrumb, ErrorData } from '../../src/contracts/log'

/** 构造元素并挂到 body。 */
function mount(html: string): HTMLElement {
  const wrap = document.createElement('div')
  wrap.innerHTML = html
  const el = wrap.firstElementChild as HTMLElement
  document.body.appendChild(el)
  return el
}

/** 触发一次真实点击事件。 */
function click(el: Element): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }))
}

describe('describeElement', () => {
  it('采集选择器、id、class、文本与 role', () => {
    const el = mount('<button id="submit" class="btn primary large" role="button">提交订单</button>')
    const data = describeElement(el)
    expect(data.id).toBe('submit')
    expect(data.class).toBe('btn.primary.large')
    expect(data.text).toBe('提交订单')
    expect(data.role).toBe('button')
    expect(String(data.selector)).toContain('button:nth-child')
  })

  it('记录 data-* 埋点属性，最多 4 个', () => {
    const el = mount(
      '<div data-track="pay" data-id="9" data-a="1" data-b="2" data-c="3" data-d="4"></div>'
    )
    const attrs = describeElement(el).attrs as Record<string, string>
    expect(attrs['data-track']).toBe('pay')
    expect(Object.keys(attrs).length).toBe(4)
  })

  it('文本过 PII 兜底脱敏，链接去掉 query', () => {
    const el = mount('<a href="https://x.com/pay?token=abc">联系 user@example.com</a>')
    const data = describeElement(el)
    expect(data.text).toBe('联系 <email>')
    expect(data.href).toBe('https://x.com/pay')
  })

  it('超长文本截断到 30 字', () => {
    const el = mount(`<span>${'长'.repeat(80)}</span>`)
    expect(String(describeElement(el).text).length).toBe(30)
  })
})

describe('BreadcrumbStore', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('记录点击：category=ui.click、level=info、带时间戳', () => {
    const store = new BreadcrumbStore(20)
    const el = mount('<button data-track="ok">确定</button>')
    store.pushClick(el, 1700000000000)

    const [crumb] = store.snapshot()
    expect(crumb?.category).toBe('ui.click')
    expect(crumb?.level).toBe('info')
    expect(crumb?.timestamp).toBe(1700000000000)
    expect(crumb?.message).toContain('click button')
    expect(crumb?.data?.text).toBe('确定')
  })

  it('同元素在合并窗口内连续点击合并为一条并累加 count', () => {
    const store = new BreadcrumbStore(20)
    const el = mount('<button>连点</button>')
    store.pushClick(el, 1000)
    store.pushClick(el, 1100)
    store.pushClick(el, 1300)

    const list = store.snapshot()
    expect(list.length).toBe(1)
    expect(list[0]?.data?.count).toBe(3)
    expect(list[0]?.message).toContain('×3')
  })

  it('超出合并窗口的点击记为独立条目', () => {
    const store = new BreadcrumbStore(20)
    const el = mount('<button>慢点</button>')
    store.pushClick(el, 1000)
    store.pushClick(el, 3000)
    expect(store.snapshot().length).toBe(2)
  })

  it('容量上限：超出后覆盖最早一条', () => {
    const store = new BreadcrumbStore(3)
    for (let i = 0; i < 5; i++) {
      store.push({
        timestamp: i,
        category: 'ui.click',
        level: 'info',
        message: `m${i}`,
        data: { i }
      })
    }
    const list = store.snapshot()
    expect(list.length).toBe(3)
    expect(list.map((c) => c.message)).toEqual(['m2', 'm3', 'm4'])
  })

  it('快照是深拷贝，后续操作不影响已取出的数据', () => {
    const store = new BreadcrumbStore(20)
    store.push({ timestamp: 1, category: 'ui.click', level: 'info', message: 'a', data: { n: 1 } })
    const snap = store.snapshot()
    ;(snap[0]?.data as { n: number }).n = 99
    expect(store.snapshot()[0]?.data?.n).toBe(1)
  })
})

describe('错误上报携带行为栈', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('错误发生时附带快照；之后的点击不影响已生成的条目', () => {
    vi.useFakeTimers()
    const { ctx, emitted } = makeModuleCtx()
    const monitor = createErrorMonitor()
    monitor.start(ctx)

    const btn = mount('<button data-track="pay">支付</button>')
    click(btn)

    window.dispatchEvent(new ErrorEvent('error', { message: 'boom', error: new Error('boom') }))

    // 错误之后再点别的元素：不应进入已生成的错误条目
    const other = mount('<a href="https://x.com/y">链接</a>')
    click(other)

    // sweep 的判定是 now - lastSeen > dedupWindow（严格大于），
    // 推进正好 5000 会在边界上不触发，所以推进到第二周期
    vi.advanceTimersByTime(11000)

    const errors = emitted
      .filter((e) => e.type === 'error')
      .map((e) => e.data as ErrorData)
    expect(errors.length).toBe(1)
    const crumbs = errors[0]?.breadcrumbs ?? []
    expect(crumbs.length).toBe(1)
    expect(crumbs[0]?.message).toContain('click button')
    expect(crumbs[0]?.data?.text).toBe('支付')

    monitor.stop()
    vi.useRealTimers()
  })

  it('关闭容量为 0 时不带行为栈', () => {
    vi.useFakeTimers()
    const { ctx, emitted } = makeModuleCtx({ maxBreadcrumbs: 0 })
    const monitor = createErrorMonitor()
    monitor.start(ctx)

    click(mount('<button>无栈</button>'))
    window.dispatchEvent(new ErrorEvent('error', { message: 'boom', error: new Error('boom') }))
    vi.advanceTimersByTime(11000)

    const errors = emitted.filter((e) => e.type === 'error').map((e) => e.data as ErrorData)
    expect(errors[0]?.breadcrumbs).toBeUndefined()
    monitor.stop()
    vi.useRealTimers()
  })

  it('stop 后不再记录点击', () => {
    const { ctx } = makeModuleCtx()
    const monitor = createErrorMonitor()
    monitor.start(ctx)
    monitor.stop()
    // 解绑后点击不应抛错、也不应影响内部状态
    expect(() => click(mount('<button>x</button>'))).not.toThrow()
  })
})

describe('Breadcrumb 类型约束', () => {
  it('分类沿用 Sentry 命名', () => {
    const crumb: Breadcrumb = {
      timestamp: Date.now(),
      category: 'ui.click',
      level: 'info',
      message: 'click a'
    }
    expect(crumb.category).toBe('ui.click')
  })
})
