// 缓存队列：上限丢弃（丢最旧）+ droppedCount + 批次尾追加丢弃通知（规格书 6.4）。
import type { CustomLog, ReportLog } from '../contracts/log'

/**
 * 上报缓存队列。
 */
export class ReportQueue {
  private logs: ReportLog[] = []
  private dropped = 0

  /**
   * @param maxSize 容量上限；超出丢最旧并累加 droppedCount
   * @param makeDroppedLog 丢弃通知日志工厂（drainAll 时把聚合计数追加到批次末尾）
   */
  constructor(
    private readonly maxSize: number,
    private readonly makeDroppedLog: (count: number) => CustomLog
  ) {}

  /**
   * 入队一条日志；超限时丢弃最旧一条并累加 droppedCount。
   * @param log 日志
   */
  add(log: ReportLog): void {
    this.logs.push(log)
    while (this.logs.length > this.maxSize) {
      this.logs.shift()
      this.dropped++
    }
  }

  /**
   * 回塞到队首并保持传入顺序（调度失败重试用）；超限时丢弃尾部（最新）条目，
   * 保证回塞的重试批次不被挤出。
   * @param logs 回塞批次
   */
  prepend(logs: ReportLog[]): void {
    this.logs = logs.concat(this.logs)
    while (this.logs.length > this.maxSize) {
      this.logs.pop()
      this.dropped++
    }
  }

  /**
   * 取走全部日志并清空；若存在丢弃计数，把自定义通知日志追加到批次末尾后清零。
   */
  drainAll(): ReportLog[] {
    const out = this.logs
    this.logs = []
    if (this.dropped > 0) {
      out.push(this.makeDroppedLog(this.dropped))
      this.dropped = 0
    }
    return out
  }

  /**
   * 当前缓存条数。
   */
  get size(): number {
    return this.logs.length
  }

  /**
   * 自上次 drainAll 以来被丢弃的条数。
   */
  get droppedCount(): number {
    return this.dropped
  }

  /**
   * 清空缓存与丢弃计数（destroy 用）。
   */
  clear(): void {
    this.logs = []
    this.dropped = 0
  }
}