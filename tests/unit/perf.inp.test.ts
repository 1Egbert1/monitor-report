// INP 分位计算测试（规格书第 11 章 perf.inp.test.ts 断言矩阵）。
import { describe, expect, it } from 'vitest'
import { InpTracker } from '../../src/modules/performance/inp'

describe('InpTracker', () => {
  it('interactionId === 0 的条目被跳过', () => {
    const tracker = new InpTracker()
    tracker.onEntry({ interactionId: 0, duration: 999 })
    expect(tracker.finalize()).toBeNull()
  })

  it('同一 interactionId 只保留最大 duration', () => {
    const tracker = new InpTracker()
    tracker.onEntry({ interactionId: 1, duration: 50 })
    tracker.onEntry({ interactionId: 1, duration: 120 })
    tracker.onEntry({ interactionId: 1, duration: 80 })
    tracker.onEntry({ interactionId: 2, duration: 200 })
    const result = tracker.finalize()
    expect(result?.count).toBe(2)
    expect(result?.value).toBe(120) // 升序 [120, 200]，98 分位索引 0
  })

  it('98 分位索引正确：index = max(0, ceil(n*0.02)-1)', () => {
    const tracker = new InpTracker()
    for (let i = 1; i <= 100; i++) {
      tracker.onEntry({ interactionId: i, duration: i })
    }
    const result = tracker.finalize()
    // n=100 → ceil(2)-1 = 1 → 第二小 = 2
    expect(result?.count).toBe(100)
    expect(result?.value).toBe(2)
  })

  it('n === 0 时不上报（返回 null）', () => {
    expect(new InpTracker().finalize()).toBeNull()
  })
})