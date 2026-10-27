// Observer 配置测试（规格书第 11 章 perf.buffered.test.ts 断言矩阵）。
import { describe, expect, it } from 'vitest'
import { PERFORMANCE_OBSERVER_CONFIGS } from '../../src/modules/performance/observers'
import { RATING_THRESHOLDS } from '../../src/constants/thresholds'

describe('PERFORMANCE_OBSERVER_CONFIGS', () => {
  it('所有 Observer 构造参数均含 buffered: true', () => {
    for (const spec of PERFORMANCE_OBSERVER_CONFIGS) {
      expect(spec.init.buffered, `${spec.metricName} 缺少 buffered: true`).toBe(true)
    }
  })

  // 不写死数量：断言「观测型指标」与「配置表」完全一致。
  // FPS 通过 requestAnimationFrame 采集，不走 PerformanceObserver，故不在配置表中——
  // 这是设计上的区分，不是漏配。
  it('配置表覆盖所有观测型指标（FPS 走 rAF，不在此列）', () => {
    const observed = Object.keys(RATING_THRESHOLDS)
      .filter((m) => m !== 'FPS')
      .sort()
    expect(PERFORMANCE_OBSERVER_CONFIGS.map((s) => s.metricName).sort()).toEqual(observed)
    // FPS 必须有阈值，否则 rating 无从计算
    expect(RATING_THRESHOLDS.FPS).toBeDefined()
  })

  it('INP 使用 event 类型且 durationThreshold=40', () => {
    const inp = PERFORMANCE_OBSERVER_CONFIGS.find((s) => s.metricName === 'INP')
    expect(inp?.init.type).toBe('event')
    expect(inp?.init.durationThreshold).toBe(40)
  })
})