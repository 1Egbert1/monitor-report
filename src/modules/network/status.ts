// 网络结果归类（规格书 7.3）：把 fetch / XHR 两条通道收敛到同一套判定。
// 存在的意义：修复「XHR 把 404/500 当成成功、fetch 当成失败」的语义分裂，
// 并给上报数据补上可区分语义的分类与文案，避免下游统一渲染成「接口异常」。
import type { NetworkStatusCategory } from '../../contracts/log'

/** 判定入参：两条通道在 onDone 前汇总出的最小事实集。 */
export interface NetworkOutcomeInput {
  /** HTTP 状态码；网络层失败/取消时为 undefined 或 0。 */
  resStatus?: number
  /** 请求被主动取消（fetch AbortError / xhr.abort）。 */
  aborted: boolean
  /** 网络层错误（xhr error 事件）。 */
  errored?: boolean
  /** 超时（xhr timeout 事件）。 */
  timedOut?: boolean
}

/** 判定结果：直接展开进 NetworkData。 */
export interface NetworkOutcome {
  resOk: boolean
  statusCategory: NetworkStatusCategory
  statusMessage: string
}

/** 常见状态码的专用文案（命中后不再走大类兜底）。 */
const STATUS_MESSAGES: Readonly<Record<number, readonly [NetworkStatusCategory, string]>> =
  Object.freeze({
    400: ['bad_request', '请求参数错误（400），检查前端提交字段与序列化格式'],
    401: ['unauthorized', '未登录或凭证已失效（401），检查 token 是否携带、是否过期、刷新逻辑是否生效'],
    403: ['forbidden', '无访问权限（403），检查账号权限、白名单或风控拦截'],
    404: ['not_found', '接口不存在（404），检查 URL 拼写与前后端接口版本是否匹配'],
    405: ['client_error', '请求方法不被允许（405），检查 GET/POST 是否用错或未走代理'],
    408: ['timeout', '请求超时（408），服务端未在约定时间内响应'],
    409: ['client_error', '资源状态冲突（409），通常为并发写或重复提交'],
    413: ['client_error', '请求体过大（413），检查上传文件或提交数据体积'],
    422: ['client_error', '参数校验未通过（422），检查后端返回的字段级错误信息'],
    429: ['client_error', '请求过于频繁（429），检查限流阈值与重试退避策略'],
    500: ['server_error', '服务端内部错误（500），属后端故障，需携带 traceId 排查'],
    502: ['server_error', '网关返回无效响应（502），检查上游服务或反向代理配置'],
    503: ['server_error', '服务暂不可用（503），通常为发布中或过载限流'],
    504: ['server_error', '网关等待上游超时（504），检查后端慢接口与网关超时配置']
  })

/**
 * 归类单次请求的结果。
 *
 * 优先级：主动取消 > 超时 > 网络层错误 > HTTP 状态码。
 * 之所以把取消排在第一位，是因为取消请求时 status 往往为 0，
 * 若先判状态码会被误记成失败（规格书 7.3 第 5 条）。
 *
 * @param input 判定入参
 * @returns 是否成功 + 语义分类 + 可直接展示的中文文案
 */
export function classifyNetworkOutcome(input: NetworkOutcomeInput): NetworkOutcome {
  const { resStatus, aborted, errored, timedOut } = input

  if (aborted) {
    return {
      resOk: true,
      statusCategory: 'aborted',
      statusMessage: '请求被主动取消，不计为失败'
    }
  }

  if (timedOut) {
    return { resOk: false, statusCategory: 'timeout', statusMessage: '请求超时，服务端未响应' }
  }

  if (errored || !resStatus) {
    return {
      resOk: false,
      statusCategory: 'network_error',
      statusMessage: '网络层失败：请求未到达服务端，或响应被 CORS/断网/插件拦截'
    }
  }

  const known = STATUS_MESSAGES[resStatus]
  if (known) {
    // 命中专用文案的都是 4xx / 5xx，一律计为失败
    return { resOk: false, statusCategory: known[0], statusMessage: known[1] }
  }

  if (resStatus === 304) {
    // 协商缓存命中：响应体为空但请求有效，不能算失败（与 301/302 未跟随区分开）
    return {
      resOk: true,
      statusCategory: 'success',
      statusMessage: '协商缓存命中（304），响应体为空，属正常缓存行为'
    }
  }

  if (resStatus >= 200 && resStatus < 300) {
    return {
      resOk: true,
      statusCategory: 'success',
      statusMessage: `请求成功（${resStatus}）`
    }
  }

  if (resStatus >= 300 && resStatus < 400) {
    return {
      resOk: false,
      statusCategory: 'redirect',
      statusMessage: `重定向未被跟随（${resStatus}），检查接口地址是否被改写或缺少 CORS 预检放行`
    }
  }

  if (resStatus >= 400 && resStatus < 500) {
    return {
      resOk: false,
      statusCategory: 'client_error',
      statusMessage: `客户端错误（${resStatus}），请求本身不符合服务端预期`
    }
  }

  return {
    resOk: false,
    statusCategory: 'server_error',
    statusMessage: `服务端错误（${resStatus}），属后端故障`
  }
}
