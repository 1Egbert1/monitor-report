// 错误三通道监听与解绑（规格书 7.1 channels.ts）。
// 每条通道独立注册：JS 错误（冒泡）/ 资源错误（capture）/ Promise 拒绝（含打标）。
import type { RawErrorData } from './normalize'
import { nodeSelector } from '../../utils/mask'

/** 通道回调。 */
export interface ErrorChannelsOpts {
  onError(data: RawErrorData): void
}

/** 事后补 catch 的 Promise 打标集合（不得当作新错误上报）。 */
const handledRejections = new WeakSet<object>()

/**
 * 会产生资源加载失败 error 事件的标签白名单。
 * 只有命中这些标签才记 resource_error —— 业务代码手动 dispatchEvent(new Event('error'))
 * 或自定义元素抛出的 error 不应被误判成资源加载失败。
 * iframe 未列入：浏览器不会为它的加载失败派发 error 事件。
 */
const RESOURCE_TAGS = new Set([
  'img',
  'script',
  'link',
  'video',
  'audio',
  'source',
  'track',
  'input'
])

/**
 * 取归一化的标签名：localName 去命名空间前缀（svg:image → image），
 * toLowerCase 兼容 XML 文档（其中 localName 不保证小写）。
 * @param el 目标元素
 */
function tagOf(el: Element): string {
  return (el.localName || el.tagName || '').toLowerCase()
}

/**
 * 注册三条错误采集通道，返回解绑函数（幂等）。
 * @param opts 归一化数据回调
 */
export function registerErrorChannels(opts: ErrorChannelsOpts): () => void {
  const onJsError = (e: Event): void => {
    const ev = e as ErrorEvent
    const err: unknown = ev.error
    const isCrossOrigin =
      ev.message === 'Script error.' ||
      (typeof ev.message !== 'string' || ev.message.trim() === '') && errInstance(err) === null
    const stack = errInstance(err) ? (err as Error).stack : undefined
    let message = typeof ev.message === 'string' && ev.message ? ev.message : ''
    if (!message && errInstance(err)) {
      message = (err as Error).message || String(err)
    }
    if (!message) {
      message = 'Unknown Error'
    }
    opts.onError({
      errorType: 'js_error',
      message,
      stack: stack ?? undefined,
      // 跨域脚本错误：统一记未知来源（README 要求 host 加 crossorigin + ACAO）
      fileName: isCrossOrigin ? 'unknown-cross-origin' : ev.filename || undefined,
      lineNo: ev.lineno || undefined,
      colNo: ev.colno || undefined,
      crossOrigin: isCrossOrigin
    })
  }

  const onResourceError = (e: Event): void => {
    const target = e.target as Node | null
    // capture 阶段收到的 JS 错误 target 为 window；元素类目标才是资源错误。
    // 用 nodeType 而非 instanceof Element：跨 realm（iframe / 其他 document）时后者的构造函数不同源，会误判。
    if (!target || target.nodeType !== 1) return
    const el = target as Element & { src?: string; href?: string; currentSrc?: string }
    const tag = tagOf(el)
    if (!RESOURCE_TAGS.has(tag)) return
    opts.onError({
      errorType: 'resource_error',
      message: `resource load error: ${tag}`,
      resourceUrl: el.currentSrc || el.src || el.href || undefined,
      resourceType: tag,
      selector: nodeSelector(el)
    })
  }

  const onRejection = (e: Event): void => {
    const ev = e as Event & { promise?: unknown; reason?: unknown }
    const promise = ev.promise
    if (typeof promise === 'object' && promise !== null && handledRejections.has(promise)) {
      return // 该 Promise 已事后补 catch（打标），跳过
    }
    const reason: unknown = ev.reason
    const err = errInstance(reason) ? (reason as Error) : null
    opts.onError({
      errorType: 'promise_error',
      message: err ? err.message || err.name : stringifyReason(reason),
      stack: err ? err.stack : undefined
    })
  }

  const onRejectionHandled = (e: Event): void => {
    // 仅打标，不作为新错误上报
    const ev = e as Event & { promise?: unknown }
    if (typeof ev.promise === 'object' && ev.promise !== null) {
      handledRejections.add(ev.promise)
    }
  }

  // 禁止 window.onerror = fn（见禁止事项 1）。
  window.addEventListener('error', onJsError)
  // 资源错误不冒泡，必须 capture（第三参 true）。
  window.addEventListener('error', onResourceError, true)
  window.addEventListener('unhandledrejection', onRejection)
  window.addEventListener('rejectionhandled', onRejectionHandled)

  return () => {
    window.removeEventListener('error', onJsError)
    window.removeEventListener('error', onResourceError, true)
    window.removeEventListener('unhandledrejection', onRejection)
    window.removeEventListener('rejectionhandled', onRejectionHandled)
  }
}

/**
 * 判断值是否为 Error 实例。
 * @param v 任意值
 */
function errInstance(v: unknown): boolean {
  return v instanceof Error
}

/**
 * 把非 Error 的拒绝原因转为字符串。
 * @param reason 拒绝原因
 */
function stringifyReason(reason: unknown): string {
  if (typeof reason === 'string') {
    return reason || 'Unhandled Promise Rejection'
  }
  try {
    const s = JSON.stringify(reason)
    return s && s !== 'undefined' ? s : 'Unhandled Promise Rejection'
  } catch {
    return 'Unhandled Promise Rejection'
  }
}