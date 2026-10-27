// 配置合并与校验（规格书 6.2）。
import type {
  ModuleType,
  ResolvedConfig,
  ResolvedModuleConfig,
  UserConfig
} from '../contracts/config'
import { DEFAULTS, MODULE_DEFAULTS, MODULE_TYPES } from '../constants/defaults'

/**
 * 按 MODULE_DEFAULTS 的键遍历合并模块专属配置。
 * 新增模块只需在契约层补一条映射与默认值，此处不再需要改动。
 * @param user 用户配置
 */
function resolveModuleConfig(user: UserConfig): ResolvedModuleConfig {
  const resolved: Record<string, Record<string, unknown>> = {}
  for (const type of MODULE_TYPES) {
    const merged = {
      ...(MODULE_DEFAULTS[type] as Record<string, unknown>),
      ...((user[type] as Record<string, unknown> | undefined) ?? {})
    }
    resolved[type] = merged
  }
  // 逐模块合并后结构与 ResolvedModuleConfig 等价，边界处断言一次（避免调用侧重复断言）
  return resolved as unknown as ResolvedModuleConfig
}

/**
 * 深合并默认配置与用户配置，校验必填项，产出只读的 ResolvedConfig。
 * @param user 用户配置
 */
export function resolveConfig(user: UserConfig): ResolvedConfig {
  if (!user.appId) {
    throw new Error('[monitor-report] appId is required')
  }
  if (!user.reportUrl && !user.request) {
    throw new Error('[monitor-report] reportUrl or request is required')
  }

  const modules: ModuleType[] = user.modules ? [...user.modules] : [...DEFAULTS.modules]

  const sample: Record<ModuleType, number> = {} as Record<ModuleType, number>
  for (const type of MODULE_TYPES) {
    sample[type] = user.sample?.[type] ?? DEFAULTS.sample[type]
  }

  // 自动把 reportUrl 加入 urlBlacklist，避免监控自身请求被采集形成递归。
  const urlBlacklist = [...(user.urlBlacklist ?? [])]
  if (user.reportUrl) {
    urlBlacklist.push(user.reportUrl)
  }

  return {
    appId: user.appId,
    reportUrl: user.reportUrl,
    env: user.env ?? DEFAULTS.env,
    modules,
    release: user.release,
    sample,
    debounceTime: user.debounceTime ?? DEFAULTS.debounceTime,
    maxLogsPerPage: user.maxLogsPerPage ?? DEFAULTS.maxLogsPerPage,
    lazyReport: user.lazyReport ?? DEFAULTS.lazyReport,
    urlBlacklist,
    ignoreErrors: [...(user.ignoreErrors ?? [])],
    dedupWindow: user.dedupWindow ?? DEFAULTS.dedupWindow,
    maskQueryKeys: [...(user.maskQueryKeys ?? [])],
    reportPerformanceOnHiddenOnly:
      user.reportPerformanceOnHiddenOnly ?? DEFAULTS.reportPerformanceOnHiddenOnly,
    maxBreadcrumbs: user.maxBreadcrumbs ?? DEFAULTS.maxBreadcrumbs,
    extra: { ...(user.extra ?? {}) },
    tags: { ...(user.tags ?? {}) },
    beforeSend: user.beforeSend,
    request: user.request,
    unloadRequest: user.unloadRequest,
    requestConfig: {
      headers: { ...(user.requestConfig?.headers ?? {}) },
      timeout: user.requestConfig?.timeout ?? DEFAULTS.requestConfig.timeout
    },
    debug: user.debug ?? DEFAULTS.debug,
    ...resolveModuleConfig(user)
  }
}