// 内存采样模块（规格书 7.4）。
// 边界：仅 Chromium 的 performance.memory；数值经量化（约 100KB 粒度）；
// 只覆盖 JS 堆（usedJSHeapSize 等），不含 DOM / CSS / GPU / Worker。
// 本模块只进 monitor-report/memory 子路径，不进全量入口的默认 modules。
import type { MonitorModule, ModuleContext } from '../../contracts/emitter'
import type { LogType } from '../../contracts/log'

/** performance.memory 结构（Chromium 专有）。 */
interface MemoryInfoLike {
  usedJSHeapSize: number
  totalJSHeapSize: number
  jsHeapSizeLimit: number
}

/** 采样点。 */
interface Sample {
  t: number
  used: number
  total: number
  limit: number
}

/** 保留最近样本数。 */
const SAMPLE_KEEP = 5

/** 小数保留位（usageRate）。 */
const RATE_ROUND = 10000

/**
 * 内存采样模块：定时间隔采样，按分钟斜率计算增长趋势，按需上报。
 */
export class MemoryMonitor implements MonitorModule {
  readonly name: LogType = 'memory'

  private ctx: ModuleContext | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private samples: Sample[] = []
  private sampleIndex = 0
  private started = false

  start(ctx: ModuleContext): void {
    if (this.started) return
    this.started = true
    this.ctx = ctx
    if (readMemory() === null) {
      return // 兼容检测失败：模块静默禁用（不上报不报错）
    }
    this.sampleIndex = 0
    this.samples = []
    this.timer = setInterval(() => {
      this.tick()
    }, ctx.config.memory.interval)
    ctx.onTeardown(() => this.clearTimer())
  }

  /**
   * 一次采样：后台标签页直接返回（定时器被节流，避免失真间隔，禁止事项 16）。
   */
  private tick(): void {
    if (!this.ctx) return
    if (document.visibilityState === 'hidden') return
    const memory = readMemory()
    if (memory === null) return
    this.record(memory)
    this.maybeEmit()
  }

  /**
   * 记录样本（保留最近 5 个）。
   * @param memory 当前内存信息
   */
  private record(memory: MemoryInfoLike): void {
    this.samples.push({
      t: Date.now(),
      used: memory.usedJSHeapSize,
      total: memory.totalJSHeapSize,
      limit: memory.jsHeapSizeLimit
    })
    if (this.samples.length > SAMPLE_KEEP) {
      this.samples.shift()
    }
    this.sampleIndex++
  }

  /**
   * 按增长阈值决定是否上报。
   */
  private maybeEmit(): void {
    if (!this.ctx) return
    const cfg = this.ctx.config.memory
    const last = this.samples[this.samples.length - 1]
    const prev = this.samples[this.samples.length - 2]
    if (!last) return

    const deltaBytes = prev ? last.used - prev.used : null
    const growthPerMinute = computeGrowth(this.samples)
    if (
      cfg.reportOnlyOnGrowth &&
      (growthPerMinute === null || growthPerMinute < cfg.growthThresholdPerMinute)
    ) {
      return
    }

    const total = last.total
    this.ctx.emitter.emit('memory', {
      usedJSHeapSize: last.used,
      totalJSHeapSize: last.total,
      jsHeapSizeLimit: last.limit,
      usageRate: total > 0 ? Math.round((last.used / total) * RATE_ROUND) / RATE_ROUND : 0,
      sampleIndex: this.sampleIndex,
      deltaBytes,
      growthPerMinute
    })
  }

  /**
   * 停止采样并清理定时器。
   */
  stop(): void {
    if (!this.started) return
    this.started = false
    this.clearTimer()
    this.samples = []
    this.ctx = null
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
  }
}

/**
 * 读取 performance.memory（不存在时返回 null → 静默禁用）。
 */
function readMemory(): MemoryInfoLike | null {
  try {
    if (typeof performance === 'undefined') return null
    const perf = performance as Performance & { memory?: MemoryInfoLike }
    const memory = perf.memory
    if (
      typeof memory !== 'object' ||
      memory === null ||
      typeof memory.usedJSHeapSize !== 'number'
    ) {
      return null
    }
    return memory
  } catch {
    return null
  }
}

/**
 * 线性斜率换算分钟增长率（字节/分钟）。
 * @param samples 最近样本（≥2 才有意义）
 */
function computeGrowth(samples: Sample[]): number | null {
  if (samples.length < 2) return null
  const first = samples[0]
  const last = samples[samples.length - 1]
  if (!first || !last) return null
  const dt = last.t - first.t
  if (dt <= 0) return null
  return ((last.used - first.used) / dt) * 60000
}

/**
 * 创建内存采样模块。
 */
export function createMemoryMonitor(): MonitorModule {
  return new MemoryMonitor()
}