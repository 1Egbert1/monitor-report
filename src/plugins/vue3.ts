// Vue 3 适配插件：挂载 app.config.errorHandler，且必须保留并调用用户原有 handler
// （禁止掩盖宿主错误处理，见禁止事项/规格书 7.5）。
import type { ErrorData } from '../contracts/log'
import type { LogReport } from '../core/LogReport'

/** Vue 3 app 的最小结构（不引入 vue 依赖）。 */
export interface Vue3App {
  config: {
    errorHandler?: ((err: unknown, instance: unknown, info: string) => void) | null
  }
}

/**
 * Vue 3 错误插件：app.use(vueErrorPlugin, { monitor })。
 */
export const vueErrorPlugin = {
  /**
   * 安装插件。
   * @param app Vue 3 应用实例
   * @param options 含 monitor 实例的选项
   */
  install(app: Vue3App, options: { monitor: LogReport }): void {
    const prev = app.config.errorHandler
    app.config.errorHandler = (err: unknown, instance: unknown, info: string): void => {
      options.monitor.addReport('error', toErrorData(err, 'vue_error', info))
      // 必须保留并调用原有 handler
      if (typeof prev === 'function') {
        prev(err, instance, info)
      }
    }
  }
}

/**
 * 把 Vue 错误归一化为 ErrorData。
 * @param err 错误对象
 * @param errorType 错误类型
 * @param info Vue 附加信息（如组件生命周期阶段）
 */
function toErrorData(
  err: unknown,
  errorType: ErrorData['errorType'],
  info: string
): ErrorData {
  const e = err instanceof Error ? err : null
  const now = Date.now()
  return {
    errorType,
    message: e ? e.message || e.name : typeof err === 'string' ? err : info || 'Vue Error',
    stack: e ? e.stack : undefined,
    count: 1,
    firstSeen: now,
    lastSeen: now
  }
}