// LCP 终值状态机（规格书 7.2）：
// 持续监听取最大候选值；禁止首个 entry 后 disconnect、禁止首次 LCP 值上报。
import { nodeSelector } from '../../utils/mask'

export interface LcpEntryLike {
  startTime: number
  /** 最大内容元素（浏览器不一定提供，如来自 bfcache 重放的条目） */
  element?: Element | null
}

/**
 * LCP 候选值跟踪：只保留更大 startTime 的条目。
 */
export class LcpTracker {
  private state: { value: number; entry: LcpEntryLike | null } = { value: 0, entry: null }

  /**
   * 更新候选条目（仅当 startTime 更大才替换）。
   * @param entry LCP 条目
   */
  onEntry(entry: LcpEntryLike): void {
    if (entry.startTime > this.state.value) {
      this.state.value = entry.startTime
      this.state.entry = entry
    }
  }

  /**
   * 当前最大候选值。
   */
  get value(): number {
    return this.state.value
  }

  /**
   * 当前候选条目（null 表示尚无 LCP）。
   */
  get entry(): LcpEntryLike | null {
    return this.state.entry
  }

  /**
   * 终值结算：返回当前最大值。
   */
  finalize(): number {
    return this.state.value
  }

  /**
   * 最大内容元素的结构选择器（脱敏后），用于定位「是哪个元素慢」。
   * 浏览器不提供 element（如 bfcache 重放条目）时返回 undefined。
   */
  get elementSelector(): string | undefined {
    const sel = nodeSelector(this.state.entry?.element)
    return sel === '' ? undefined : sel
  }
}