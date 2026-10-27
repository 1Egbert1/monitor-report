// 路由变化与输入聚焦的行为栈测试（规格书 7.1）：
// 四个来源（pushState / replaceState / popstate / hashchange）都要覆盖，
// 并验证 teardown 后原生 history 方法被完整还原。
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createErrorMonitor } from '../../src/modules/error'
import { makeModuleCtx } from '../helpers'
import type { Breadcrumb } from '../../src/contracts/log'

interface Cell {
  store: { snapshot(): Breadcrumb[] }
}

/** 取当前行为栈（通过模块内部字段，仅测试用）。 */
function crumbs(monitor: unknown): Breadcrumb[] {
  const cell = monitor as unknown as Cell
  return cell.store ? cell.store.snapshot() : []
}

/** 启动一个只收集行为栈的错误模块，并把内部 store 暴露出来。 */
function boot(config: Record<string, unknown> = {}) {
  const { ctx, emitted } = makeModuleCtx(config)
  const monitor = createErrorMonitor()
  monitor.start(ctx)
  const internal = monitor as unknown as { breadcrumbs: { snapshot(): Breadcrumb[] } }
  Object.defineProperty(monitor as unknown as Cell, 'store', {
    get: () => internal.breadcrumbs,
    configurable: true
  })
  return { monitor, emitted }
}

/** 导航后取最后一条 navigation 行为。 */
function lastNav(monitor: unknown): Breadcrumb | undefined {
  return crumbs(monitor)
    .filter((c) => c.category === 'navigation')
    .pop()
}

describe('路由变化记录', () => {
  afterEach(() => {
    window.location.hash = ''
  })

  it('pushState 记录一条 kind=pushState 的 navigation', () => {
    const { monitor } = boot()
    history.pushState({}, '', '/order/detail')

    const nav = lastNav(monitor)
    expect(nav?.category).toBe('navigation')
    expect(nav?.data?.kind).toBe('pushState')
    expect(String(nav?.data?.to)).toContain('/order/detail')
    expect(nav?.message).toContain('navigate')
    monitor.stop()
  })

  it('replaceState 到相同地址不记录（路由库常用来同步 query）', () => {
    const { monitor } = boot()
    history.replaceState({}, '', '/same')
    const before = crumbs(monitor).length
    history.replaceState({}, '', '/same')
    expect(crumbs(monitor).length).toBe(before)
    monitor.stop()
  })

  it('query 被脱敏，白名单键保留', () => {
    const { monitor } = boot({ maskQueryKeys: ['page'] })
    history.pushState({}, '', '/list?token=secret&page=2')

    const nav = lastNav(monitor)
    const to = String(nav?.data?.to)
    expect(to).toContain('token=[filtered]')
    expect(to).toContain('page=2')
    monitor.stop()
  })

  it('popstate 与 hashchange 都能记录（不判断路由模式）', () => {
    const { monitor } = boot()

    // 先改地址再派发 popstate：模拟浏览器前进/后退
    history.pushState({}, '', '/from-push')
    window.dispatchEvent(new PopStateEvent('popstate'))
    // 同上一次地址相同，合并窗口内不重复记录
    expect(crumbs(monitor).filter((c) => c.category === 'navigation').length).toBe(1)

    window.location.hash = '#tab-2'
    const list = crumbs(monitor).filter((c) => c.category === 'navigation')
    expect(list.some((c) => c.data?.kind === 'hashchange')).toBe(true)
    monitor.stop()
  })

  it('stop 后不再记录，且方法调用不抛错', () => {
    const { monitor } = boot()
    history.pushState({}, '', '/before-stop')
    expect(crumbs(monitor).length).toBe(1)

    monitor.stop()
    const snapshotAfterStop = crumbs(monitor).length

    expect(() => history.pushState({}, '', '/after-stop')).not.toThrow()
    expect(crumbs(monitor).length).toBe(snapshotAfterStop)
  })

  it('stop 会把 pushState / replaceState 还原成原生实现', () => {
    const nativePush = history.pushState
    const nativeReplace = history.replaceState
    const { monitor } = boot()
    expect(history.pushState).not.toBe(nativePush)

    monitor.stop()
    expect(history.pushState).toBe(nativePush)
    expect(history.replaceState).toBe(nativeReplace)
  })
})

describe('输入聚焦记录', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('focusin 记录 ui.input，且不含输入内容', () => {
    const { monitor } = boot()
    const textarea = document.createElement('textarea')
    textarea.id = 'remark'
    textarea.textContent = '这是用户之前填的备注'
    document.body.appendChild(textarea)

    textarea.dispatchEvent(new FocusEvent('focusin', { bubbles: true, composed: true }))

    const crumb = crumbs(monitor).find((c) => c.category === 'ui.input')
    expect(crumb?.message).toContain('focus textarea#remark')
    expect(crumb?.data?.id).toBe('remark')
    // 隐私：textarea 的 textContent 是内容本身，必须不出现
    expect(crumb?.data?.text).toBeUndefined()
    monitor.stop()
  })

  it('input 只记录 type，不记录 value', () => {
    const { monitor } = boot()
    const input = document.createElement('input')
    input.type = 'password'
    input.value = 'my-secret'
    document.body.appendChild(input)

    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true, composed: true }))

    const crumb = crumbs(monitor).find((c) => c.category === 'ui.input')
    expect(crumb?.data?.type).toBe('password')
    expect(JSON.stringify(crumb)).not.toContain('my-secret')
    monitor.stop()
  })

  it('非表单元素的 focusin 不记录', () => {
    const { monitor } = boot()
    const div = document.createElement('div')
    div.tabIndex = 0
    document.body.appendChild(div)

    div.dispatchEvent(new FocusEvent('focusin', { bubbles: true, composed: true }))
    expect(crumbs(monitor).some((c) => c.category === 'ui.input')).toBe(false)
    monitor.stop()
  })
})

describe('容量为 0 时完全关闭', () => {
  it('不注册监听，也不产生任何行为', () => {
    const nativePush = history.pushState
    const { monitor } = boot({ maxBreadcrumbs: 0 })
    expect(history.pushState).toBe(nativePush)

    history.pushState({}, '', '/any')
    const btn = document.createElement('button')
    document.body.appendChild(btn)
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(crumbs(monitor)).toEqual([])
    monitor.stop()
  })
})
