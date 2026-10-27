// FPS 统计测试：
// 1. 按秒分桶算平均 FPS；
// 2. 掉帧率与最长单帧（分布信息，避免平均值掩盖长尾）；
// 3. 页面隐藏/恢复不能被算成超长帧（这是最容易出错的地方）；
// 4. 无样本时返回 null，不上报 0。
import { describe, expect, it } from 'vitest'
import { FpsTracker } from '../../src/modules/performance/fps'

/** 从 t 开始喂入 deltas（每项是一帧的间隔），返回结束时刻。 */
function feed(tracker: FpsTracker, t: number, deltas: readonly number[]): number {
  let now = t
  for (const d of deltas) {
    now += d
    tracker.onFrame(now)
  }
  return now
}

describe('FpsTracker', () => {
  it('按秒分桶：跑满 2 秒的稳定 60fps 得到两个约 60 的样本', () => {
    const tracker = new FpsTracker()
    tracker.start(0)
    feed(tracker, 0, Array.from({ length: 120 }, () => 16.7))
    const r = tracker.finalize()
    expect(r?.sampleCount).toBe(2)
    expect(r?.avgFps).toBeCloseTo(60, 0)
    expect(r?.dropRate).toBe(0)
  })

  it('识别掉帧：超过 33ms 的帧计入 dropRate', () => {
    const tracker = new FpsTracker()
    tracker.start(0)
    // 4 帧正常（16.7ms）+ 1 帧掉帧（80ms），再补满一秒保证桶成立
    const now = feed(tracker, 0, [16.7, 16.7, 16.7, 16.7, 80])
    feed(tracker, now, Array.from({ length: 60 }, () => 16.7))
    const r = tracker.finalize()
    // 共 65 帧，其中 1 帧超过 33ms
    expect(r?.dropRate).toBeCloseTo(1 / 65, 2)
    expect(r?.maxFrameDuration).toBe(80)
    expect(r?.avgFps).toBeGreaterThan(0)
  })

  it('页面隐藏后再恢复，不能被算成超长帧', () => {
    const tracker = new FpsTracker()
    tracker.start(0)
    feed(tracker, 0, [16.7, 16.7])

    tracker.pause()
    // 切后台 30 秒
    tracker.resume(30000)
    // 恢复后跑满一秒（60 帧），保证有样本可结算
    feed(tracker, 30000, Array.from({ length: 60 }, () => 16.7))

    const r = tracker.finalize()
    // 30 秒空档不应产生任何帧间隔
    expect(r?.maxFrameDuration).toBeCloseTo(16.7, 0)
    expect(r?.dropRate).toBe(0)
    expect(r?.avgFps).toBeGreaterThan(0)
  })

  it('只喂一帧不产生样本（桶未满），返回 null', () => {
    const tracker = new FpsTracker()
    tracker.start(0)
    tracker.onFrame(16.7)
    expect(tracker.finalize()).toBeNull()
  })

  it('pause 期间的帧不计入统计', () => {
    const tracker = new FpsTracker()
    tracker.start(0)
    // 第一段：2 帧（未满桶，不产生样本）
    feed(tracker, 0, [16.7, 16.7])
    tracker.pause()
    // pause 后仍在发帧，不应被记录
    feed(tracker, 0, [16.7, 16.7])
    tracker.resume(2000)
    // 第二段：一秒稳定 60fps
    feed(tracker, 2000, Array.from({ length: 60 }, () => 16.7))
    const r = tracker.finalize()
    // pause 期间的 2 帧不应混进样本，只有 resume 后的一桶
    expect(r?.sampleCount).toBe(1)
    expect(r?.avgFps).toBeCloseTo(60, 0)
    expect(r?.dropRate).toBe(0)
  })
})
