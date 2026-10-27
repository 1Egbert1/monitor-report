// 行为栈（对齐 Sentry breadcrumb）：环形缓冲记录用户操作，错误发生时快照随日志上报。
// 设计要点：不独立上报（否则就是一堆噪声点击日志），只在聚合到错误时取快照。
import type { Breadcrumb } from '../../contracts/log'
import { maskPiiText, nodeSelector } from '../../utils/mask'

/** 元素可读文本截断长度。 */
const TEXT_MAX = 30

/** 记录的 class 数量上限。 */
const CLASS_MAX = 3

/** 记录的 data-* 属性数量上限。 */
const ATTR_MAX = 4

/** 单个属性值截断长度。 */
const ATTR_VALUE_MAX = 50

/** 同元素连续点击的合并窗口（毫秒）。 */
const MERGE_WINDOW_MS = 500

/**
 * 把点击目标描述成结构化数据。
 * 只用事件目标自身的信息，不读取输入内容（隐私），文本一律过 PII 兜底脱敏。
 * @param el 被点击的元素（shadow DOM 场景传 composedPath[0]）
 */
export function describeElement(el: Element): Record<string, unknown> {
  const data: Record<string, unknown> = { selector: nodeSelector(el) }

  if (el.id) {
    data.id = el.id
  }

  const classes = Array.from(el.classList).slice(0, CLASS_MAX)
  if (classes.length > 0) {
    data.class = classes.join('.')
  }

  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, TEXT_MAX)
  if (text) {
    data.text = maskPiiText(text)
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
 * @param tag 标签名（小写）
 * @param el 目标元素
 */
function summarize(tag: string, el: Element): string {
  const id = el.id ? `#${el.id}` : ''
  const cls = Array.from(el.classList).slice(0, 2)
  const classPart = cls.length > 0 ? `.${cls.join('.')}` : ''
  return `click ${tag}${id}${classPart}`
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
    const key = `${tag}|${String(data.selector)}`

    if (key === this.lastKey && now - this.lastAt <= MERGE_WINDOW_MS) {
      const last = this.items[this.items.length - 1]
      if (last) {
        const count = Number(last.data?.count ?? 1) + 1
        last.data = { ...last.data, count }
        last.message = `${summarize(tag, el)} ×${count}`
        this.lastAt = now
        return
      }
    }

    this.push({
      timestamp: now,
      category: 'ui.click',
      level: 'info',
      message: summarize(tag, el),
      data
    })
    this.lastKey = key
    this.lastAt = now
  }

  /**
   * 追加一条行为（供后续扩展 ui.input / navigation 等分类使用）。
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
