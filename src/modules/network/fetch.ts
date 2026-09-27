// fetch 包装（规格书 7.3）：保留 this 与全部参数原样透传，返回值必须是原始 Response。
// 禁止替换/消费 Response（禁止事项 8）；AbortError 不计为失败（禁止事项 9）。
import type { NetworkData } from '../../contracts/log'

/** 包装选项。 */
export interface FetchWrapOptions {
  onDone(data: NetworkData): void
  isBlacklisted(url: string): boolean
}

/** 附带包装标记的 fetch 函数形状。 */
interface WrappedFetch {
  (input: RequestInfo | URL, init?: RequestInit): Promise<Response>
  __monitorWrapped?: boolean
}

/**
 * 包装 window.fetch；返回解绑函数（仅当当前仍是本次包裹的函数时恢复）。
 * @param opts 包装选项
 */
export function wrapFetch(opts: FetchWrapOptions): () => void {
  const original = window.fetch
  if (typeof original !== 'function' || (original as WrappedFetch).__monitorWrapped) {
    return () => {
      // 已包裹或环境无 fetch：无操作
    }
  }

  const wrapped = function (
    this: Window,
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    const url = extractUrl(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    const start = performanceTimelineNow()

    if (!url || opts.isBlacklisted(url)) {
      // 黑名单（含自动追加的 reportUrl）请求不采集，原样透传
      return original.call(this, input as RequestInfo, init)
    }

    const finish = (
      data: Pick<
        NetworkData,
        'resOk' | 'resStatus' | 'aborted' | 'errorMessage'
      >
    ): void => {
      opts.onDone({
        reqUrl: url,
        reqMethod: method,
        reqStartTime: start,
        reqDuration: performanceTimelineNow() - start,
        ...data
      })
    }

    return original.call(this, input as RequestInfo, init).then(
      (res) => {
        finish({ resOk: res.ok, resStatus: res.status, aborted: false })
        return res // 必须返回原始 Response 本身
      },
      (err: unknown) => {
        const e = err as { name?: string; message?: string } | null
        const aborted = typeof e?.name === 'string' && e.name === 'AbortError'
        // AbortError：aborted=true 且 resOk=true，退出时同样透传
        if (aborted) {
          finish({ resOk: true, aborted: true })
        } else {
          finish({
            resOk: false,
            aborted: false,
            errorMessage: e?.message ?? String(e ?? 'fetch failed')
          })
        }
        throw err // 不得吞掉错误
      }
    )
  } as WrappedFetch

  wrapped.__monitorWrapped = true
  window.fetch = wrapped as typeof window.fetch

  return () => {
    if (window.fetch === (wrapped as typeof window.fetch)) {
      window.fetch = original
    }
  }
}

/**
 * 提取入参 URL：string / URL / Request 三种形态。
 * @param input fetch 入参
 */
function extractUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (typeof URL !== 'undefined' && input instanceof URL) return input.href
  if (typeof Request !== 'undefined' && input instanceof Request) return input.url
  return ''
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