// Web Vitals 评级阈值（见规格书 5.2）：只用于生成 rating，绝不用于过滤数据。

/** 性能指标名（与 PerformanceData.metricName 对应）。 */
export type MetricName = 'FCP' | 'LCP' | 'FID' | 'INP' | 'CLS'

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
    CLS: Object.freeze({ good: 0.1, needsImprovement: 0.25 })
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
  if (value <= pair.good) return 'good'
  if (value <= pair.needsImprovement) return 'needs-improvement'
  return 'poor'
}