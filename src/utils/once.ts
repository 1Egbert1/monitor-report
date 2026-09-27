// 一次性调用包装：保证回调至多执行一次（用于终值结算等场景）。

/**
 * 将函数包装为至多执行一次；首次之后调用返回 undefined。
 * @param fn 需一次性执行的函数
 */
export function once<Args extends unknown[], R>(
  fn: (...args: Args) => R
): (...args: Args) => R | undefined {
  let called = false
  return function onceWrapper(...args: Args): R | undefined {
    if (called) return undefined
    called = true
    return fn(...args)
  }
}