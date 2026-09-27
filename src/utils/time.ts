// 时间相关工具：时间戳、timeOrigin 校正、导航类型（所有 DOM 访问均在函数内部）。

/** 页面导航类型（Navigation Timing API 定义 + 缺省值）。 */
export type NavigationType = 'navigate' | 'reload' | 'back_forward' | 'prerender' | 'unknown'

/**
 * 返回当前毫秒时间戳。
 */
export function now(): number {
  return Date.now()
}

/**
 * 以 timeOrigin + entry.startTime 为事件时刻做客户端时钟校正。
 * @param entryStartTime 事件在 performance 时间轴上的 startTime；无对应条目的日志传 0
 */
export function correctedNow(entryStartTime: number): number {
  const timeOrigin =
    typeof performance !== 'undefined' && typeof performance.timeOrigin === 'number'
      ? performance.timeOrigin
      : 0
  return now() - Math.round(timeOrigin + entryStartTime)
}

/**
 * 读取当前页面的导航类型；环境不支持或类型未知时返回 'unknown'。
 */
export function getNavigationType(): NavigationType {
  try {
    if (typeof performance === 'undefined') return 'unknown'
    const nav = performance.getEntriesByType(
      'navigation'
    )[0] as PerformanceNavigationTiming | undefined
    const t = nav ? nav.type : undefined
    if (t === 'navigate' || t === 'reload' || t === 'back_forward' || t === 'prerender') {
      return t
    }
    return 'unknown'
  } catch {
    return 'unknown'
  }
}