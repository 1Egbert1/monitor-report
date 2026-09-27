// Observer 配置测试（规格书第 11 章 perf.buffered.test.ts 断言矩阵）。
import { describe, expect, it } from 'vitest'
import { PERFORMANCE_OBSERVER_CONFIGS } from '../../src/modules/performance/observers'

describe('PERFORMANCE_OBSERVER_CONFIGS', () => {
  it('所有 Observer 构造参数均含 buffered: true', () => {
    expect(PERFORMANCE_OBSERVER_CONFIGS.length).toBe(5)
    for (const spec of PERFORMANCE_OBSERVER_CONFIGS) {
      expect(spec.init.buffered, `${spec.metricName} 缺少 buffered: true`).toBe(true)
    }
  })

  it('INP 使用 event 类型且 durationThreshold=40', () => {
    const inp = PERFORMANCE_OBSERVER_CONFIGS.find((s) => s.metricName === 'INP')
    expect(inp?.init.type).toBe('event')
    expect(inp?.init.durationThreshold).toBe(40)
  })
})