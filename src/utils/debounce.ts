// 防抖句柄：批报调度使用。

/** 可取消的防抖句柄。 */
export interface DebounceHandle {
  schedule(): void
  cancel(): void
}

/**
 * 创建防抖句柄：schedule 后 delay 内未被 cancel 则执行 fn。
 * @param fn 到期执行的回调
 * @param delay 防抖间隔（ms）
 */
export function debounce(fn: () => void, delay: number): DebounceHandle {
  let timer: ReturnType<typeof setTimeout> | null = null
  return {
    schedule() {
      if (timer !== null) return
      timer = setTimeout(() => {
        timer = null
        fn()
      }, delay)
    },
    cancel() {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
    }
  }
}