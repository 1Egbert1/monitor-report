// Long Task 聚合（诊断指标，非 Core Web Vital）：
// 只统计超过 50ms 的主线程任务，把阻塞时间累加，不逐条上报。
/** 长任务判定阈值（RAIL 模型定义，超过即视为阻塞主线程）。 */
const LONG_TASK_THRESHOLD_MS = 50

/** longtask 条目的最小结构（不继承 PerformanceEntry，便于脱离浏览器测试）。 */
export interface LongTaskLike {
  duration: number
  startTime: number
}

/** Long Task 聚合结果。 */
export interface LongTaskResult {
  /** 总阻塞时长 ms = Σ max(0, duration - 50) */
  value: number
  /** 长任务个数 */
  count: number
  /** 最长单个任务时长 ms */
  maxDuration: number
}

/**
 * Long Task 聚合与结算。
 * 与 INP 的区别：INP 只看交互相关的 event 条目，LT 覆盖所有主线程长任务（含非交互期间）。
 */
export class LongTaskTracker {
  private count = 0
  private blockingTime = 0
  private maxDuration = 0

  /**
   * 收集一条长任务条目。
   * @param entry longtask 条目
   */
  onEntry(entry: LongTaskLike): void {
    this.count++
    // 只累加超过 50ms 的部分：50ms 以内是浏览器留给主线程的正常预算，不算阻塞
    this.blockingTime += Math.max(0, entry.duration - LONG_TASK_THRESHOLD_MS)
    if (entry.duration > this.maxDuration) {
      this.maxDuration = entry.duration
    }
  }

  /**
   * 结算：无长任务时返回 null（不上报 0，避免稀释统计）。
   */
  finalize(): LongTaskResult | null {
    if (this.count === 0) {
      return null
    }
    return {
      value: Math.round(this.blockingTime),
      count: this.count,
      maxDuration: Math.round(this.maxDuration)
    }
  }
}
