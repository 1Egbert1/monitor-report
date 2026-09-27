// INP 分位计算（规格书 7.2）：
// 仅 interactionId > 0（禁止事项 17）；同一 interactionId 只保留最大 duration；98 分位结算。
export interface InpEntryLike {
  interactionId: number
  duration: number
}

/**
 * INP 交互持续时长聚合与 98 分位结算。
 */
export class InpTracker {
  private durations = new Map<number, number>()

  /**
   * 收集一条交互条目。
   * @param entry 交互条目
   */
  onEntry(entry: InpEntryLike): void {
    if (entry.interactionId === 0) {
      return // interactionId 无效，跳过，否则污染分位计算
    }
    const prev = this.durations.get(entry.interactionId)
    if (prev === undefined || entry.duration > prev) {
      this.durations.set(entry.interactionId, entry.duration)
    }
  }

  /**
   * 结算 98 分位：升序后取 index = max(0, ceil(n*0.02)-1)；n === 0 时返回 null（不上报）。
   */
  finalize(): { value: number; count: number } | null {
    const sorted = [...this.durations.values()].sort((a, b) => a - b)
    const n = sorted.length
    if (n === 0) {
      return null
    }
    const idx = Math.max(0, Math.ceil(n * 0.02) - 1)
    return { value: sorted[idx] ?? 0, count: n }
  }
}