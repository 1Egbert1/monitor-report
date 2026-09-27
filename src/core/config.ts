// 配置合并与校验（规格书 6.2）。
import type { ModuleType, ResolvedConfig, UserConfig } from '../contracts/config'
import { DEFAULTS } from '../constants/defaults'

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

  const sample: Record<ModuleType, number> = {
    error: user.sample?.error ?? DEFAULTS.sample.error,
    performance: user.sample?.performance ?? DEFAULTS.sample.performance,
    network: user.sample?.network ?? DEFAULTS.sample.network,
    memory: user.sample?.memory ?? DEFAULTS.sample.memory
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
    extra: { ...(user.extra ?? {}) },
    tags: { ...(user.tags ?? {}) },
    beforeSend: user.beforeSend,
    request: user.request,
    unloadRequest: user.unloadRequest,
    requestConfig: {
      headers: { ...(user.requestConfig?.headers ?? {}) },
      timeout: user.requestConfig?.timeout ?? DEFAULTS.requestConfig.timeout
    },
    performance: {
      clsReportThreshold:
        user.performance?.clsReportThreshold ?? DEFAULTS.performance.clsReportThreshold
    },
    network: {
      collectResourceTiming: user.network?.collectResourceTiming ?? DEFAULTS.network.collectResourceTiming
    },
    memory: {
      interval: user.memory?.interval ?? DEFAULTS.memory.interval,
      reportOnlyOnGrowth: user.memory?.reportOnlyOnGrowth ?? DEFAULTS.memory.reportOnlyOnGrowth,
      growthThresholdPerMinute:
        user.memory?.growthThresholdPerMinute ?? DEFAULTS.memory.growthThresholdPerMinute
    },
    debug: user.debug ?? DEFAULTS.debug
  }
}