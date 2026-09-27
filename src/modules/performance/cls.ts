// CLS 会话窗口（规格书 7.2）：hadRecentInput 必须跳过；1s 间隔 / 5s 窗口开启新会话；取最大窗口值。
import { nodeSelector } from '../../utils/mask'

/** layout-shift 条目（要素子集）。 */
export interface LayoutShiftLike {
  value: number
  hadRecentInput: boolean
  startTime: number
  sources?: Array<{ node?: Element | null }>
}

/** 相邻位移间隔阈值（ms）。 */
const GAP_MS = 1000

/** 会话窗口最大时长（ms）。 */
const WINDOW_MAX_MS = 5000

/** layoutShiftSources 上限。 */
const SOURCE_LIMIT = 5

/** CLS 值保留 4 位小数。 */
const ROUND_FACTOR = 10000

/**
 * CLS 会话窗口跟踪：维护当前窗口与历史最大窗口值。
 */
export class ClsTracker {
  private window: { value: number; startTime: number; lastEntryTime: number } | null = null
  private maxValue = 0
  private sources: string[] = []

  /**
   * 处理一条位移条目。
   * @param entry 位移条目
   */
  onEntry(entry: LayoutShiftLike): void {
    if (entry.hadRecentInput) {
      return // 必须跳过（禁止事项无关，规格书明确要求）
    }
    if (this.window === null) {
      this.window = { value: 0, startTime: entry.startTime, lastEntryTime: entry.startTime }
    } else if (
      entry.startTime - this.window.lastEntryTime > GAP_MS ||
      entry.startTime - this.window.startTime > WINDOW_MAX_MS
    ) {
      // 结算旧窗口（maxValue 已在上次累加处更新）并开启新窗口
      this.window = { value: 0, startTime: entry.startTime, lastEntryTime: entry.startTime }
    }
    this.window.value += entry.value
    this.window.lastEntryTime = entry.startTime
    if (this.window.value > this.maxValue) {
      this.maxValue = this.window.value
    }
    this.collectSources(entry.sources)
  }

  /**
   * 收集位移来源选择器（脱敏后，最多 5 条）。
   * @param sources 来源数组
   */
  private collectSources(sources?: Array<{ node?: Element | null }>): void {
    if (!sources) return
    for (const source of sources) {
      if (this.sources.length >= SOURCE_LIMIT) return
      const sel = nodeSelector(source.node)
      if (sel) {
        this.sources.push(sel)
      }
    }
  }

  /**
   * 终值结算：最大会话窗口值（保留 4 位小数）。
   */
  finalize(): { value: number; sources: string[] } {
    return {
      value: Math.round(this.maxValue * ROUND_FACTOR) / ROUND_FACTOR,
      sources: this.sources.slice(0, SOURCE_LIMIT)
    }
  }
}