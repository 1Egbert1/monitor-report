// 数据脱敏器（规格书第 9 章）：URL query 脱敏、选择器脱敏、文本 PII 兜底、堆栈截断。
import type { ReportLog } from '../contracts/log'
import { STACK_MAX_FRAMES } from '../constants/defaults'

/** 邮箱正则（兜底 PII）。 */
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[A-Za-z]{2,}/g

/** 中国大陆手机号正则（兜底 PII）。 */
const PHONE_RE = /(^|[^0-9])(1[3-9][0-9]{9})([^0-9]|$)/g

/** 18 位身份证正则（兜底 PII）。 */
const ID_RE = /(^|[^0-9])([0-9]{17}[0-9Xx])([^0-9]|$)/g

/** 选择器保留的最多层数。 */
const SELECTOR_MAX_DEPTH = 4

/**
 * 对文本做兜底 PII 脱敏：邮箱 / 手机号 / 身份证（先长后短，避免子串重叠）。
 * @param str 输入文本
 */
export function maskPiiText(str: string): string {
  if (!str) return str
  return str
    .replace(ID_RE, '$1<id>$3')
    .replace(PHONE_RE, '$1<phone>$3')
    .replace(EMAIL_RE, '<email>')
}

/**
 * 判断文本是否疑似包含兜底 PII（邮箱 / 手机号 / 身份证）。
 * @param str 输入文本
 */
export function containsPii(str: string): boolean {
  if (!str) return false
  return testAny(str, [ID_RE, PHONE_RE, EMAIL_RE])
}

/**
 * 用一组全局正则逐一检测（重置 lastIndex 避免状态残留）。
 * @param str 输入文本
 * @param res 正则列表
 */
function testAny(str: string, res: RegExp[]): boolean {
  for (const re of res) {
    re.lastIndex = 0
    if (re.test(str)) return true
  }
  return false
}

/**
 * 脱敏 URL：query 中非白名单 key 的值一律置 `[filtered]`，hash 做 PII 兜底脱敏。
 * @param rawUrl 原始 URL
 * @param keepKeys query 值保留的白名单 key
 */
export function maskUrlQuery(rawUrl: string, keepKeys: readonly string[]): string {
  if (!rawUrl) return rawUrl
  const hashIdx = rawUrl.indexOf('#')
  const base = hashIdx === -1 ? rawUrl : rawUrl.slice(0, hashIdx)
  const hash = hashIdx === -1 ? '' : rawUrl.slice(hashIdx + 1)

  const qIdx = base.indexOf('?')
  if (qIdx === -1) {
    return hash ? `${maskPiiText(base)}#${maskPiiText(hash)}` : maskPiiText(base)
  }
  const path = base.slice(0, qIdx)
  const query = base.slice(qIdx + 1)
  const maskedQuery = query
    .split('&')
    .map((seg) => {
      const eq = seg.indexOf('=')
      if (eq === -1) return seg
      const key = seg.slice(0, eq)
      const val = seg.slice(eq + 1)
      return `${key}=${keepKeys.includes(key) ? val : '[filtered]'}`
    })
    .join('&')
  const masked = `${path}?${maskedQuery}`
  return hash ? `${masked}#${maskPiiText(hash)}` : maskPiiText(masked)
}

/**
 * 堆栈截断到指定帧数（默认为 STACK_MAX_FRAMES）。
 * @param stack 原始堆栈
 * @param maxFrames 保留帧数
 */
export function truncateStack(stack: string, maxFrames: number = STACK_MAX_FRAMES): string {
  if (!stack) return stack
  return stack
    .split('\n')
    .slice(0, Math.max(1, maxFrames))
    .join('\n')
}

/**
 * 堆栈内 URL 的 query 脱敏（保留 URL 后附的 :行:列 号）。
 * SPEC-GAP: 规格书第 9 章对 stack 仅要求截断，但禁止事项 13 禁止上报体携带原始 query 值；
 * 实测堆栈帧携带页面完整 URL（含 query），故对帧内 URL 逐条做 query 脱敏。
 * @param stack 原始堆栈
 * @param keepKeys query 值保留白名单
 */
export function maskStackUrlQuery(stack: string, keepKeys: readonly string[]): string {
  if (!stack) return stack
  return stack.replace(/https?:\/\/[^\s)'"]+/gi, (chunk) => {
    const lineCol = /:\d+:\d+$/.exec(chunk)
    if (lineCol && lineCol.index !== undefined) {
      const urlPart = chunk.slice(0, lineCol.index)
      const tail = chunk.slice(lineCol.index)
      return maskUrlQuery(urlPart, keepKeys) + tail
    }
    return maskUrlQuery(chunk, keepKeys)
  })
}

/**
 * 选择器脱敏：只保留 `标签[:nth-child(n)]` 序列，最多 4 层，丢弃 id/class/data-*。
 * @param sel 任意来源的选择器字符串
 */
export function sanitizeSelector(sel: string): string {
  if (!sel) return sel
  const out: string[] = []
  for (const part of sel.split(/\s*>\s*/)) {
    const tagMatch = /^[a-zA-Z][\w-]*/.exec(part)
    const tag = tagMatch ? tagMatch[0].toLowerCase() : ''
    if (!tag) continue
    const nth = /:nth-child\(\d+\)/.exec(part)
    out.push(nth ? `${tag}${nth[0]}` : tag)
  }
  return out.slice(-SELECTOR_MAX_DEPTH).join(' > ')
}

/**
 * 生成元素的安全选择器：`父标签:nth-child(n) > …`，最多 4 层，不含 id/class/data-*。
 * @param el 目标元素
 */
export function nodeSelector(el: Element | null | undefined): string {
  if (!el || el.nodeType !== 1) return ''
  const parts: string[] = []
  let cur: Element | null = el
  while (cur && parts.length < SELECTOR_MAX_DEPTH) {
    parts.unshift(`${cur.tagName.toLowerCase()}:nth-child(${indexOfSibling(cur)})`)
    cur = cur.parentElement
  }
  return parts.join(' > ')
}

/**
 * 计算元素在其兄弟元素中的 1 起序号。
 * @param el 目标元素
 */
function indexOfSibling(el: Element): number {
  let i = 1
  let prev = el.previousElementSibling
  while (prev) {
    i++
    prev = prev.previousElementSibling
  }
  return i
}

/**
 * 对单条日志的 payload 执行管道第 5 步定型脱敏；不递归清洗 extra/tags（宿主责任）。
 * 公共字段（pageUrl 等）已上移到上报体的 context，在 transport 组装时脱敏，此处不处理。
 * 泛型保留具体日志类型的 payload 形状，方便调用方按成员访问。
 * @param log 待脱敏日志
 * @param keepKeys query 值保留白名单
 */
export function maskLog<T extends ReportLog>(log: T, keepKeys: readonly string[]): T {
  const masked = { ...log } as T
  const data: Record<string, unknown> = {}
  for (const key of Object.keys(log.data)) {
    data[key] = maskValue(key, (log.data as Record<string, unknown>)[key], keepKeys)
  }
  // eslint-disable-next-line no-extra-semi -- 前置分号防止与上方 for 语句产生 ASI 歧义
  ;(masked as { data: unknown }).data = data as T['data']
  return masked
}

/**
 * 按字段名与值类型做对应脱敏。
 * @param key 字段名
 * @param value 字段值
 * @param keepKeys query 值保留白名单
 */
function maskValue(key: string, value: unknown, keepKeys: readonly string[]): unknown {
  if (typeof value === 'string') {
    // fileName 常为完整脚本 URL（含 query），与 resourceUrl/reqUrl 一并脱敏；
    // 规格书第 9 章未列该字段，但禁止事项 13 禁止上报体携带原始 query 值。
    if (key === 'resourceUrl' || key === 'reqUrl' || key === 'fileName') {
      return maskUrlQuery(value, keepKeys)
    }
    if (key === 'selector') return sanitizeSelector(value)
    if (key === 'stack') return truncateStack(maskStackUrlQuery(value, keepKeys))
    return maskPiiText(value)
  }
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === 'string' ? maskPiiText(item) : item))
  }
  return value
}