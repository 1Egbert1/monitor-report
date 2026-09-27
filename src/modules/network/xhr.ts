// XHR 包装（规格书 7.3）：WeakMap 元数据（禁止实例挂可枚举属性，禁止事项 7）；
// 包装 open/send，监听 loadend/error/timeout/abort；包装幂等（__monitorWrapped）。
import type { NetworkData } from '../../contracts/log'

/** 单请求元数据。 */
interface XhrMeta {
  method: string
  url: string
  start: number
  aborted: boolean
  timedOut: boolean
  errored: boolean
  reported: boolean
  listening: boolean
}

/** 元数据表（WeakMap：不进实例属性、自动回收）。 */
const metaMap = new WeakMap<XMLHttpRequest, XhrMeta>()

/** 包装选项。 */
export interface XhrWrapOptions {
  onDone(data: NetworkData): void
  isBlacklisted(url: string): boolean
}

/**
 * 包装 XMLHttpRequest.prototype 的 open/send；返回解绑函数。
 * @param opts 包装选项
 */
export function wrapXhr(opts: XhrWrapOptions): () => void {
  if (typeof window.XMLHttpRequest === 'undefined') {
    return () => {
      // 环境无 XHR：无操作
    }
  }
  const proto = window.XMLHttpRequest.prototype as typeof XMLHttpRequest.prototype & {
    open?: typeof XMLHttpRequest.prototype.open & { __monitorWrapped?: boolean }
  }
  const openOriginal = proto.open
  const sendOriginal = proto.send
  if (!openOriginal || !sendOriginal || openOriginal.__monitorWrapped) {
    return () => {
      // 已包裹：防多 SDK 递归
    }
  }

  // 用 rest 参数透传（保持调用参数个数与原函数一致），cast 为宽松签名便于转发。
  const wrappedOpen = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ): void {
    metaMap.set(this, {
      method: method.toUpperCase(),
      url: String(url),
      start: 0,
      aborted: false,
      timedOut: false,
      errored: false,
      reported: false,
      listening: false
    })
    return (openOriginal as (...args: unknown[]) => void).call(this, method, url, ...rest)
  }

  const wrappedSend = function (this: XMLHttpRequest, ...args: unknown[]): void {
    const meta = metaMap.get(this)
    if (!meta) {
      return (sendOriginal as (...rest: unknown[]) => void).call(this, ...args)
    }
    meta.start = performanceTimelineNow()
    meta.reported = false
    if (!meta.listening) {
      meta.listening = true
      attachListeners(this, meta, opts)
    }
    return (sendOriginal as (...rest: unknown[]) => void).call(this, ...args)
  }

  const wrappedOpenWithMarker = wrappedOpen as typeof openOriginal & {
    __monitorWrapped?: boolean
  }
  wrappedOpenWithMarker.__monitorWrapped = true
  proto.open = wrappedOpenWithMarker
  proto.send = wrappedSend as typeof sendOriginal

  return () => {
    if (proto.open === wrappedOpenWithMarker) {
      proto.open = openOriginal
    }
    if (proto.send === wrappedSend) {
      proto.send = sendOriginal
    }
  }
}

/**
 * 给实例挂上统一出口监听（成功/失败都走 loadend 结算，只上报一次）。
 * @param xhr 实例
 * @param meta 元数据
 * @param opts 包装选项
 */
function attachListeners(
  xhr: XMLHttpRequest,
  meta: XhrMeta,
  opts: XhrWrapOptions
): void {
  xhr.addEventListener('abort', () => {
    meta.aborted = true
  })
  xhr.addEventListener('timeout', () => {
    meta.timedOut = true
  })
  xhr.addEventListener('error', () => {
    meta.errored = true
  })
  xhr.addEventListener('loadend', () => {
    if (meta.reported) return
    meta.reported = true
    if (opts.isBlacklisted(meta.url)) return

    const aborted = meta.aborted
    const resOk = aborted ? true : !meta.errored && !meta.timedOut
    opts.onDone({
      reqUrl: meta.url,
      reqMethod: meta.method,
      reqStartTime: meta.start,
      reqDuration: performanceTimelineNow() - meta.start,
      resOk,
      resStatus: xhr.status || undefined,
      resStatusText: xhr.statusText || undefined,
      aborted,
      errorMessage: meta.errored ? 'network error' : meta.timedOut ? 'timeout' : undefined
    })
  })
}

/**
 * performance 时间轴当前时刻（不存在时回退 0）。
 */
function performanceTimelineNow(): number {
  try {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : 0
  } catch {
    return 0
  }
}