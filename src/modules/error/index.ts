// 错误监控模块入口：三通道采集 + 归一化 + 计数式去重（规格书 7.1）。
import type { MonitorModule, ModuleContext } from '../../contracts/emitter'
import { defineModule } from '../../contracts/emitter'
import type { ErrorData, LogLevel, LogType } from '../../contracts/log'
import { DEDUP_MAP_MAX } from '../../constants/defaults'
import { matchesIgnore } from '../../utils/rules'
import { fingerprint, type RawErrorData } from './normalize'
import { registerErrorChannels } from './channels'
import { BreadcrumbStore } from './breadcrumb'

/** 去重表条目。 */
interface DedupEntry {
  count: number
  firstSeen: number
  lastSeen: number
  raw: RawErrorData
}

/**
 * 错误监控模块：去重 = 计数聚合（不是丢弃），窗口到期 / 页面隐藏 / stop() 时统一 emit。
 */
export class ErrorMonitor implements MonitorModule {
  readonly name: LogType = 'error'

  private ctx: ModuleContext | null = null
  private dedup = new Map<string, DedupEntry>()
  private cleanups: Array<() => void> = []
  private breadcrumbs: BreadcrumbStore | null = null
  private started = false

  start(ctx: ModuleContext): void {
    if (this.started) return
    this.started = true
    this.ctx = ctx

    const off = registerErrorChannels({ onError: (raw) => this.aggregate(raw) })
    this.cleanups.push(off)

    // 行为栈（对齐 Sentry breadcrumb）：只记录用户操作，不独立上报
    this.breadcrumbs = new BreadcrumbStore(ctx.config.maxBreadcrumbs)
    const onDocumentClick = (e: Event): void => {
      const path = typeof e.composedPath === 'function' ? e.composedPath() : []
      // shadow DOM 内部元素的点击会被 retarget 成 host，composedPath()[0] 才是真实目标
      const target = (path[0] ?? e.target) as Node | null
      if (!target || target.nodeType !== 1) return
      this.breadcrumbs?.pushClick(target as Element)
    }
    document.addEventListener('click', onDocumentClick, true)
    this.cleanups.push(() => document.removeEventListener('click', onDocumentClick, true))

    // 单个定时器扫描全部指纹（禁止每条错误一个定时器）
    const timer = setInterval(() => {
      this.sweep()
    }, ctx.config.dedupWindow)
    const clearTimer = () => clearInterval(timer)
    this.cleanups.push(clearTimer)
    ctx.onTeardown(clearTimer)
  }

  /**
   * 页面隐藏时由核心在卸载 flush 前调用（规格书 6.4 第①步）：立即结算聚合条目。
   */
  onPageHidden(): void {
    this.flushAll()
  }

  /**
   * 聚合一条错误：命中指纹仅递增计数（不 emit）；新指纹入表（LRU 淘汰）。
   * @param raw 归一化前原始数据
   */
  private aggregate(raw: RawErrorData): void {
    if (!this.ctx) return
    const fp = fingerprint({
      errorType: raw.errorType,
      message: raw.message,
      fileName: raw.fileName,
      stack: raw.stack,
      crossOrigin: raw.crossOrigin ?? false
    })
    const existing = this.dedup.get(fp)
    const now = Date.now()
    if (existing) {
      existing.count++
      existing.lastSeen = now
      return
    }
    if (this.dedup.size >= DEDUP_MAP_MAX) {
      // LRU：Map 插入序即最近性，淘汰最早插入的一条
      const oldest = this.dedup.keys().next().value
      if (oldest !== undefined) {
        this.dedup.delete(oldest)
      }
    }
    // 快照在错误首次出现时取，而不是在上报时取 —— 上报可能延迟数秒，
    // 那时用户已经做了别的操作，快照会失真
    const snapshot = this.breadcrumbs?.snapshot() ?? []
    this.dedup.set(fp, {
      count: 1,
      firstSeen: now,
      lastSeen: now,
      raw: snapshot.length > 0 ? { ...raw, breadcrumbs: snapshot } : raw
    })
  }

  /**
   * 扫描去重表：距 lastSeen 超过 dedupWindow 的条目 emit 后移除。
   */
  private sweep(): void {
    if (!this.ctx) return
    const now = Date.now()
    const window = this.ctx.config.dedupWindow
    for (const [fp, entry] of this.dedup) {
      if (now - entry.lastSeen > window) {
        this.dedup.delete(fp)
        this.emitEntry(entry)
      }
    }
  }

  /**
   * 立即 emit 全部聚合条目（页面隐藏 / stop 时）。
   */
  private flushAll(): void {
    if (!this.ctx) return
    for (const [fp, entry] of this.dedup) {
      this.dedup.delete(fp)
      this.emitEntry(entry)
    }
  }

  /**
   * 把聚合条目补全 count/firstSeen/lastSeen 后交给管道。
   * @param entry 聚合条目
   */
  private emitEntry(entry: DedupEntry): void {
    if (!this.ctx) return
    this.ctx.emitter.emit('error', {
      ...entry.raw,
      count: entry.count,
      firstSeen: entry.firstSeen,
      lastSeen: entry.lastSeen
    })
  }

  /**
   * 停止模块：flush 剩余聚合条目并解绑全部监听与定时器。
   */
  stop(): void {
    if (!this.started) return
    this.started = false
    this.flushAll()
    for (const fn of this.cleanups) {
      fn()
    }
    this.cleanups = []
    this.breadcrumbs?.clear()
    this.breadcrumbs = null
    this.ctx = null
  }
}

/**
 * 创建错误监控模块。
 */
export function createErrorMonitor(): MonitorModule {
  return new ErrorMonitor()
}

/** chunk / 动态 import 加载失败的正则：这类错误几乎必然导致页面功能不可用，升为 fatal。 */
const CHUNK_LOAD_FAIL_RE = /Loading chunk .* failed|ChunkLoadError|Importing a module script failed/i

/**
 * 错误严重级别（对齐 Sentry 的 event level）。
 * 规则是确定性的，不需要业务方标注：
 * - 资源错误：script 失败按 error（会导致后续功能不可用），其他标签按 warning
 * - JS 错误：chunk 加载失败升 fatal，其余 error
 * - Promise / Vue：error
 * @param data 错误数据
 */
function levelOfError(data: ErrorData): LogLevel {
  if (data.errorType === 'resource_error') {
    return data.resourceType === 'script' ? 'error' : 'warning'
  }
  if (data.errorType === 'js_error' && CHUNK_LOAD_FAIL_RE.test(data.message)) {
    return 'fatal'
  }
  return 'error'
}

/** 错误模块自描述：生命周期 + 管道过滤（ignoreErrors）+ 级别映射。 */
export const errorModule = defineModule({
  type: 'error',
  create: createErrorMonitor,
  filter: (data, config) => matchesIgnore(data.message, config.ignoreErrors),
  levelOf: levelOfError
})