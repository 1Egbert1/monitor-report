// Web Vitals 评级阈值（见规格书 5.2）：只用于生成 rating，绝不用于过滤数据。

/**
 * 性能指标名（与 PerformanceData.metricName 对应）。
 * 前五个是 Core Web Vitals；`LT` 是诊断指标（Long Task 总阻塞时长），不参与 CWV 评分。
 */
export type MetricName = 'FCP' | 'LCP' | 'FID' | 'INP' | 'CLS' | 'LT' | 'FPS'

/**
 * 通过 PerformanceObserver 的 entry 分发的指标。
 * FPS 走 requestAnimationFrame，不走 observer，故排除在外——
 * 这样 handleEntry 的 switch 只需覆盖真实可达的分支，assertNever 不会误报。
 */
export type ObservedMetricName = Exclude<MetricName, 'FPS'>

/** 单指标阈值对：good 上限之外即 needs-improvement，超过即 poor。 */
interface ThresholdPair {
  readonly good: number
  readonly needsImprovement: number
}

/** 各指标评级阈值表。 */
export const RATING_THRESHOLDS: Readonly<Record<MetricName, ThresholdPair>> =
  Object.freeze({
    FCP: Object.freeze({ good: 1800, needsImprovement: 3000 }),
    LCP: Object.freeze({ good: 2500, needsImprovement: 4000 }),
    FID: Object.freeze({ good: 100, needsImprovement: 300 }),
    INP: Object.freeze({ good: 200, needsImprovement: 500 }),
    CLS: Object.freeze({ good: 0.1, needsImprovement: 0.25 }),
    // LT 是诊断指标，阈值参考 Lighthouse 的 TBT（200 / 600）。
    // 注意口径差异：TBT 只统计 FCP→TTI 窗口内的阻塞，LT 统计整个页面生命周期，
    // 故相同数值不可直接与 TBT 报告对比，这里只用于粗分档。
    LT: Object.freeze({ good: 200, needsImprovement: 600 }),
    // FPS 越高越好（与其余指标方向相反，getRating 里特判）。
    // 阈值参考游戏/视频行业的 60/30 经验值，非 W3C 标准。
    FPS: Object.freeze({ good: 50, needsImprovement: 30 })
  })

/**
 * 依据阈值计算评级（仅用于生成 rating 字段，禁止用于丢弃数据）。
 * @param metric 指标名
 * @param value 指标值
 */
export function getRating(
  metric: MetricName,
  value: number
): 'good' | 'needs-improvement' | 'poor' {
  const pair = RATING_THRESHOLDS[metric]
  // FPS 是唯一的「越高越好」指标，判定方向与其余相反
  if (metric === 'FPS') {
    if (value >= pair.good) return 'good'
    if (value >= pair.needsImprovement) return 'needs-improvement'
    return 'poor'
  }
  if (value <= pair.good) return 'good'
  if (value <= pair.needsImprovement) return 'needs-improvement'
  return 'poor'
}