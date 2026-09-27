// 环境守卫：浏览器支持检测（所有检测均在函数内部执行）。

/**
 * 是否处于浏览器环境（window 与 document 均存在）。
 */
export function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined'
}

/**
 * 是否具备 SDK 所需的最小能力集；不满足时所有能力静默降级为 no-op。
 */
export function isSupported(): boolean {
  if (!isBrowser()) return false
  return (
    typeof Object.defineProperty === 'function' &&
    typeof WeakMap !== 'undefined' &&
    typeof window.addEventListener === 'function'
  )
}