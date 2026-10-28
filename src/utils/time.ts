// 时间相关工具：时间戳、timeOrigin 校正、导航类型（所有 DOM 访问均在函数内部）。

/** 页面导航类型（Navigation Timing API 定义 + 缺省值）。 */
export type { NavigationType } from '../contracts/log'
import type { NavigationType } from '../contracts/log'

/**
 * 返回当前毫秒时间戳。
 */
export function now(): number {
  return Date.now()
}

/**
 * 事件发生时刻（毫秒时间戳）。
 * 有 performance 事件起点时用 `timeOrigin + entryStartTime` 换算——时间轴单调，不受系统时钟跳变影响；
 * 无起点（如自定义日志）或非浏览器环境时退回 `Date.now()`。
 * @param entryStartTime 事件在 performance 时间轴上的 startTime；无对应条目传 undefined
 */
export function eventTimestamp(entryStartTime?: number): number {
  const timeOrigin =
    typeof performance !== 'undefined' && typeof performance.timeOrigin === 'number'
      ? performance.timeOrigin
      : undefined
  if (entryStartTime !== undefined && timeOrigin !== undefined) {
    return Math.round(timeOrigin + entryStartTime)
  }
  return now()
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