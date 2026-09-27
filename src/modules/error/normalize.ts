// 错误归一化与指纹（规格书 7.1 normalize.ts）。
import type { ErrorData } from '../../contracts/log'
import { fnv1a } from '../../utils/hash'

/** 未聚合的原始错误数据（count/firstSeen/lastSeen 由去重层填充）。 */
export type RawErrorData = Omit<ErrorData, 'count' | 'firstSeen' | 'lastSeen'>

/** UUID 替换。 */
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

/** 长 hex 替换。 */
const HEX_RE = /[0-9a-f]{16,}/gi

/** URL 替换。 */
const URL_RE = /https?:\/\/[^\s)'"]+/gi

/** 数字串替换。 */
const DIGIT_RE = /\d+/g

/** 引号内容替换。 */
const QUOTE_RE = /'[^']*'|"[^"]*"/g

/** 消息截断长度。 */
const MESSAGE_MAX = 300

/**
 * 归一化错误消息：去空白 → 截断 → UUID/hex/URL/数字/引号内容 依次替换。
 * @param msg 原始消息
 */
export function normalizeMessage(msg: string): string {
  let out = msg.trim().slice(0, MESSAGE_MAX)
  out = out.replace(UUID_RE, '<uuid>')
  out = out.replace(HEX_RE, '<hex>')
  out = out.replace(URL_RE, '<url>')
  out = out.replace(DIGIT_RE, '<n>')
  out = out.replace(QUOTE_RE, '<str>')
  return out
}

/**
 * 计算稳定指纹（fnv1a 32 位数字字符串，禁止 crypto API）。
 * @param error 错误要素
 */
export function fingerprint(error: {
  errorType: ErrorData['errorType']
  message: string
  fileName?: string
  stack?: string
  crossOrigin: boolean
}): string {
  const key = [
    error.errorType,
    normalizeMessage(error.message),
    basenameWithoutHash(error.fileName ?? ''),
    topFrameFnName(error.stack ?? ''),
    error.crossOrigin ? 'x' : ''
  ].join('|')
  return fnv1a(key)
}

/**
 * 取文件名（去 query/hash，并以 /[.-][0-9a-f]{6,}\./i 剥离构建 hash）。
 * @param fileName 原始文件名/路径
 */
export function basenameWithoutHash(fileName: string): string {
  if (!fileName) return ''
  const cut = fileName.split(/[?#]/)[0] ?? ''
  const base = cut.slice(cut.lastIndexOf('/') + 1)
  return base.replace(/[.-][0-9a-f]{6,}(?=\.)/i, '')
}

/**
 * 取堆栈首帧函数名（不含行列号；首行可能是错误消息行，需逐行找帧）。
 * @param stack 原始堆栈
 */
export function topFrameFnName(stack: string): string {
  for (const line of stack.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const atMatch = /^\s*at\s+([^\s(]+)/.exec(trimmed)
    if (atMatch && atMatch[1]) {
      if (atMatch[1] === 'new') continue
      return atMatch[1]
    }
    const legacy = /^([^\s@]+)@/.exec(trimmed)
    if (legacy && legacy[1]) {
      return legacy[1]
    }
  }
  return ''
}