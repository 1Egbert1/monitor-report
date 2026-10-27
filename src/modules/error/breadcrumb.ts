// 行为栈（对齐 Sentry breadcrumb）：环形缓冲记录用户操作，错误发生时快照随日志上报。
// 设计要点：不独立上报（否则就是一堆噪声点击日志），只在聚合到错误时取快照。
import type { Breadcrumb } from '../../contracts/log'
import { maskPiiText, maskUrlQuery, nodeSelector } from '../../utils/mask'

/** 元素可读文本截断长度。 */
const TEXT_MAX = 30

/** 记录的 class 数量上限。 */
const CLASS_MAX = 3

/** 记录的 data-* 属性数量上限。 */
const ATTR_MAX = 4

/** 单个属性值截断长度。 */
const ATTR_VALUE_MAX = 50

/** 连续同类行为的合并窗口（毫秒）。 */
const MERGE_WINDOW_MS = 500

/**
 * 表单控件标签：**永不采集文本**。
 * `<textarea>初始内容</textarea>` 的 textContent 就是内容本身，`<select>` 的 textContent 是全部选项文案，
 * 都可能带用户数据，直接跳过。
 */
export const FORM_TAGS: ReadonlySet<string> = new Set(['input', 'textarea', 'select'])

/** 路由变化的触发来源（记录事实，不判断应用用的是 history 还是 hash 模式）。 */
export type NavigationKind = 'pushState' | 'replaceState' | 'popstate' | 'hashchange'

/**
 * 把元素描述成结构化数据。
 * 只读元素自身属性，不读取任何输入内容；文本一律过 PII 兜底脱敏。
 * @param el 目标元素（shadow DOM 场景传 composedPath[0]）
 */
export function describeElement(el: Element): Record<string, unknown> {
  const tag = (el.localName || el.tagName || '').toLowerCase()
  const data: Record<string, unknown> = { selector: nodeSelector(el) }

  if (el.id) {
    data.id = el.id
  }

  const classes = Array.from(el.classList).slice(0, CLASS_MAX)
  if (classes.length > 0) {
    data.class = classes.join('.')
  }

  if (FORM_TAGS.has(tag)) {
    // 表单控件只记类型，不记内容
    const type = el.getAttribute('type')
    if (type) {
      data.type = type
    }
  } else {
    const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, TEXT_MAX)
    if (text) {
      data.text = maskPiiText(text)
    }
  }

  const attrs: Record<string, string> = {}
  for (const attr of Array.from(el.attributes)) {
    if (Object.keys(attrs).length >= ATTR_MAX) break
    if (!attr.name.startsWith('data-')) continue
    attrs[attr.name] = maskPiiText(attr.value.slice(0, ATTR_VALUE_MAX))
  }
  if (Object.keys(attrs).length > 0) {
    data.attrs = attrs
  }

  const role = el.getAttribute('role') ?? el.getAttribute('aria-label')
  if (role) {
    data.role = maskPiiText(role.slice(0, TEXT_MAX))
  }

  // 链接只保留 path（去 query，避免把 token / 参数带进日志）
  const href = (el as HTMLAnchorElement).href
  if (typeof href === 'string' && href) {
    data.href = maskPiiText(href.split(/[?#]/)[0] ?? '')
  }

  return data
}

/**
 * 生成人类可读摘要，如 `click button#submit.primary`。
 * @param verb 动作词（click / focus / navigate）
 * @param tag 标签名（小写）
 * @param el 目标元素
 */
function summarize(verb: string, tag: string, el: Element): string {
  const id = el.id ? `#${el.id}` : ''
  const cls = Array.from(el.classList).slice(0, 2)
  const classPart = cls.length > 0 ? `.${cls.join('.')}` : ''
  return `${verb} ${tag}${id}${classPart}`
}

/** 判断新的时间戳是否落在合并窗口内。 */
function withinWindow(now: number, lastAt: number): boolean {
  return now - lastAt <= MERGE_WINDOW_MS
}

/**
 * 行为栈环形缓冲。
 */
export class BreadcrumbStore {
  private items: Breadcrumb[] = []
  private lastKey = ''
  private lastAt = 0

  /**
   * @param max 容量上限（超出覆盖最早一条）
   */
  constructor(private readonly max: number) {}

  /**
   * 记录一次元素点击；同元素在合并窗口内的连续点击合并为一条并累加 count。
   * @param el 被点击的元素
   * @param now 当前时间戳（注入以便测试）
   */
  pushClick(el: Element, now: number = Date.now()): void {
    const tag = (el.localName || el.tagName || '').toLowerCase()
    const data = describeElement(el)
    const key = `click|${tag}|${String(data.selector)}`

    if (key === this.lastKey && withinWindow(now, this.lastAt)) {
      const last = this.items[this.items.length - 1]
      if (last) {
        const count = Number(last.data?.count ?? 1) + 1
        last.data = { ...last.data, count }
        last.message = `${summarize('click', tag, el)} ×${count}`
        this.lastAt = now
        return
      }
    }

    this.push({
      timestamp: now,
      category: 'ui.click',
      level: 'info',
      message: summarize('click', tag, el),
      data
    })
    this.lastKey = key
    this.lastAt = now
  }

  /**
   * 记录一次输入聚焦（只记表单控件，永不记录输入内容）。
   * @param el 聚焦的元素
   * @param now 当前时间戳
   */
  pushFocus(el: Element, now: number = Date.now()): void {
    const tag = (el.localName || el.tagName || '').toLowerCase()
    const key = `focus|${tag}|${nodeSelector(el)}`
    if (key === this.lastKey && withinWindow(now, this.lastAt)) {
      this.lastAt = now
      return
    }
    this.push({
      timestamp: now,
      category: 'ui.input',
      level: 'info',
      message: summarize('focus', tag, el),
      data: describeElement(el)
    })
    this.lastKey = key
    this.lastAt = now
  }

  /**
   * 记录一次路由变化。同一个 from→to 在合并窗口内只记一条（路由库可能重复 replaceState）。
   * @param from 变化前地址（原始，未脱敏）
   * @param to 变化后地址（原始，未脱敏）
   * @param kind 触发来源
   * @param keepQueryKeys 允许保留取值的 query 键（其余打码）
   * @param now 当前时间戳
   */
  pushNavigation(
    from: string,
    to: string,
    kind: NavigationKind,
    keepQueryKeys: readonly string[] = [],
    now: number = Date.now()
  ): void {
    if (!to || from === to) return
    const maskedFrom = maskUrlQuery(from, keepQueryKeys)
    const maskedTo = maskUrlQuery(to, keepQueryKeys)
    const key = `nav|${maskedFrom}|${maskedTo}`
    if (key === this.lastKey && withinWindow(now, this.lastAt)) {
      this.lastAt = now
      return
    }
    this.push({
      timestamp: now,
      category: 'navigation',
      level: 'info',
      message: `navigate ${maskedFrom} -> ${maskedTo}`,
      data: { from: maskedFrom, to: maskedTo, kind }
    })
    this.lastKey = key
    this.lastAt = now
  }

  /**
   * 追加一条行为（供后续扩展新分类使用）。
   * @param crumb 行为条目
   */
  push(crumb: Breadcrumb): void {
    this.items.push(crumb)
    if (this.items.length > this.max) {
      this.items.splice(0, this.items.length - this.max)
    }
  }

  /**
   * 取当前快照（深拷贝，避免上报后继续被改写）。
   */
  snapshot(): Breadcrumb[] {
    if (this.items.length === 0) return []
    return this.items.map((item) => ({
      ...item,
      data: item.data ? { ...item.data } : undefined
    }))
  }

  /** 当前条数。 */
  get size(): number {
    return this.items.length
  }

  /** 清空（销毁时调用）。 */
  clear(): void {
    this.items = []
    this.lastKey = ''
    this.lastAt = 0
  }
}
