// 性能监控模块：FCP / LCP / FID / INP / CLS，终态上报（规格书 7.2）。
import type { MonitorModule, ModuleContext } from '../../contracts/emitter'
import { defineModule } from '../../contracts/emitter'
import type { LogType, PerformanceData } from '../../contracts/log'
import { getRating } from '../../constants/thresholds'
import { PERF_REPORT_FALLBACK_MS } from '../../constants/defaults'
import { getNavigationType } from '../../utils/time'
import { PERFORMANCE_OBSERVER_CONFIGS } from './observers'
import { LcpTracker } from './lcp'
import { ClsTracker, type LayoutShiftLike } from './cls'
import { InpTracker, type InpEntryLike } from './inp'

/**
 * 性能监控模块：reportPerformanceOnHiddenOnly（默认）时除 FID 外全部在隐藏时结算上报。
 */
export class PerformanceMonitor implements MonitorModule {
  readonly name: LogType = 'performance'

  private ctx: ModuleContext | null = null
  private observers: PerformanceObserver[] = []
  private fcp: { value: number } | null = null
  private fidSent = false
  private lcp = new LcpTracker()
  private cls = new ClsTracker()
  private inp = new InpTracker()
  private finalized = false
  private fallbackTimer: ReturnType<typeof setTimeout> | null = null

  start(ctx: ModuleContext): void {
    if (typeof PerformanceObserver === 'undefined') {
      return // 环境不支持：静默降级
    }
    this.ctx = ctx
    this.observeAll()

    // 长驻页面兜底：未见隐藏也在 PERF_REPORT_FALLBACK_MS 后结算一次
    this.fallbackTimer = setTimeout(() => {
      this.onPageHidden()
    }, PERF_REPORT_FALLBACK_MS)
    const clearTimer = () => {
      if (this.fallbackTimer !== null) {
        clearTimeout(this.fallbackTimer)
        this.fallbackTimer = null
      }
    }
    ctx.onTeardown(clearTimer)

    // 初始化时页面已隐藏（SDK 晚于用户切走）：立即用 buffered 数据结算上报一次
    if (ctx.isPageHidden()) {
      this.onPageHidden()
    }
  }

  /**
   * 页面隐藏 / pagehide / 销毁前由核心调用（规格书 6.4 第①步）：结算并上报全部终值。
   */
  onPageHidden(): void {
    if (this.finalized || !this.ctx) return
    this.finalized = true
    if (this.fallbackTimer !== null) {
      clearTimeout(this.fallbackTimer)
      this.fallbackTimer = null
    }
    this.disconnectObservers()

    const nav = getNavigationType()
    // bfcache 恢复（back_forward）时 FCP / LCP 无意义，不上报；INP / CLS 正常。
    if (nav !== 'back_forward') {
      if (this.fcp) {
        this.emitMetric({
          metricName: 'FCP',
          value: this.fcp.value,
          entryType: 'paint',
          startTime: this.fcp.value
        })
      }
      if (this.lcp.entry) {
        const value = this.lcp.finalize()
        this.emitMetric({
          metricName: 'LCP',
          value,
          entryType: 'largest-contentful-paint',
          startTime: value
        })
      }
    }

    const clsResult = this.cls.finalize()
    // 阈值只用于过滤上报量（默认 0 全量），绝不参与 rating 计算与数据丢弃判定。
    if (clsResult.value >= this.ctx.config.performance.clsReportThreshold) {
      this.emitMetric({
        metricName: 'CLS',
        value: clsResult.value,
        entryType: 'layout-shift',
        startTime: performanceTimelineNow(),
        layoutShiftSources: clsResult.sources
      })
    }

    const inpResult = this.inp.finalize()
    if (inpResult) {
      this.emitMetric({
        metricName: 'INP',
        value: inpResult.value,
        entryType: 'event',
        startTime: performanceTimelineNow(),
        interactionCount: inpResult.count
      })
    }
  }

  /**
   * 停止模块：断开全部 Observer、清理兜底定时器（不产生上报，规格书未要求 destroy 时结算）。
   */
  stop(): void {
    // SPEC-GAP: 规格书未把 destroy 列入结算时机；SPA 卸载场景的性能终值依赖页面隐藏/兜底定时器。
    this.disconnectObservers()
    if (this.fallbackTimer !== null) {
      clearTimeout(this.fallbackTimer)
      this.fallbackTimer = null
    }
    this.ctx = null
  }

  /**
   * 建立全部指标的 Observer（构造参数含 buffered: true，见 observers.ts）。
   */
  private observeAll(): void {
    for (const spec of PERFORMANCE_OBSERVER_CONFIGS) {
      try {
        const obs = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            this.handleEntry(spec.metricName, entry)
          }
        })
        obs.observe(spec.init)
        this.observers.push(obs)
      } catch {
        // 该 entryType 不受支持（如 Safari 早期无 event 类型）：静默降级
      }
    }
  }

  /**
   * 按指标分发条目。
   * @param metric 指标名
   * @param entry 原始条目
   */
  private handleEntry(
    metric: PerformanceData['metricName'],
    entry: PerformanceEntry
  ): void {
    switch (metric) {
      case 'FCP':
        this.onPaintEntry(entry)
        break
      case 'LCP':
        this.lcp.onEntry(entry)
        break
      case 'FID':
        this.onFidEntry(entry)
        break
      case 'INP':
        this.inp.onEntry(entry as unknown as InpEntryLike)
        break
      case 'CLS':
        this.cls.onEntry(entry as unknown as LayoutShiftLike)
        break
    }
  }

  /**
   * FCP：只认 first-contentful-paint；关闭隐藏上报开关时采集即上报。
   * @param entry paint 条目
   */
  private onPaintEntry(entry: PerformanceEntry): void {
    if (entry.name !== 'first-contentful-paint' || this.fcp) return
    this.fcp = { value: entry.startTime }
    if (this.ctx && !this.ctx.config.reportPerformanceOnHiddenOnly && !this.finalized) {
      this.emitMetric({
        metricName: 'FCP',
        value: entry.startTime,
        entryType: 'paint',
        startTime: entry.startTime
      })
    }
  }

  /**
   * FID：取 processingStart - startTime，采集即上报（唯一不等待隐藏的指标）。
   * @param entry first-input 条目
   */
  private onFidEntry(entry: PerformanceEntry): void {
    if (this.fidSent) return
    const processingStart = (entry as PerformanceEventTiming).processingStart
    if (typeof processingStart !== 'number') return
    this.fidSent = true
    this.emitMetric({
      metricName: 'FID',
      value: processingStart - entry.startTime,
      entryType: 'first-input',
      startTime: entry.startTime
    })
  }

  /**
   * 补全 rating 后 emit。
   * @param data 指标数据（不含 rating）
   */
  private emitMetric(data: Omit<PerformanceData, 'rating'>): void {
    if (!this.ctx) return
    this.ctx.emitter.emit('performance', {
      ...data,
      rating: getRating(data.metricName, data.value)
    })
  }

  /**
   * 断开全部 Observer（幂等，仅在结算 / 停止时调用，禁止首个 LCP 后断开）。
   */
  private disconnectObservers(): void {
    for (const obs of this.observers) {
      try {
        obs.disconnect()
      } catch {
        // 已断开的 Observer 忽略
      }
    }
    this.observers = []
  }
}

/**
 * 读取 performance 时间轴当前时刻（不存在时回退 0）。
 */
function performanceTimelineNow(): number {
  try {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : 0
  } catch {
    return 0
  }
}

/**
 * 创建性能监控模块。
 */
export function createPerformanceMonitor(): MonitorModule {
  return new PerformanceMonitor()
}

/** 性能模块自描述：生命周期 + 以指标 startTime 作为事件起点 + 评级映射级别。 */
export const performanceModule = defineModule({
  type: 'performance',
  create: createPerformanceMonitor,
  startTimeOf: (data) => data.startTime,
  // 指标本身是观测数据（info）；评级为 poor 说明该指标已影响体验，升为 warning
  levelOf: (data) => (data.rating === 'poor' ? 'warning' : 'info')
})