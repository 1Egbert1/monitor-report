// FPS 统计（诊断指标，非 Core Web Vital）：
// 用 requestAnimationFrame 打点，按秒分桶采样，保留分布而非只算平均。
//
// 两个必须处理的坑（都有实际事故对应的）：
// ① 必须用 performance.now()（单调递增）。用 Date.now() 时，系统时钟回拨会让 delta 变负。
// ② 页面隐藏时 rAF 会停止，但时钟继续走 —— 切后台 30 秒后回来，
//    首帧 delta = 30000ms，会算出 FPS ≈ 0.03 的假值。必须 pause/resume 跳过不可见期间。

/** 掉帧判定阈值：按 60Hz 约定（16.7ms/帧），超过 2 帧时间即视为掉帧。 */
const DROP_THRESHOLD_MS = 33

/** 一桶的时长（ms），与「FPS = 每秒帧数」的定义对齐。 */
const BUCKET_MS = 1000

/** 超过该间隔不计入帧统计（属于长任务或 pause 空档，不是「帧」）。 */
const MAX_FRAME_MS = 1000

/** FPS 聚合结果。 */
export interface FpsResult {
  /** 平均 FPS（各秒样本的平均） */
  avgFps: number
  /** 掉帧率 0-1：超过 33ms 的帧占比 */
  dropRate: number
  /** 最长单帧间隔 ms */
  maxFrameDuration: number
  /** 样本数（每秒一个） */
  sampleCount: number
}

/**
 * FPS 采样与结算。
 * 与 LongTaskTracker 的分工：LT 测「主线程被占多久」，FPS 测「画面是否流畅」。
 * 5 个 40ms 任务不会触发 LT（都 <50ms），但可能连掉 12 帧——只有 FPS 能看到。
 */
export class FpsTracker {
  private running = false
  private lastFrameTime = 0
  private bucketStart = 0
  private framesInBucket = 0
  private readonly samples: number[] = []
  private totalFrames = 0
  private droppedFrames = 0
  private maxFrameDuration = 0

  /**
   * 开始采样。
   * @param now performance.now() 的当前值
   */
  start(now: number): void {
    this.running = true
    this.lastFrameTime = 0
    this.bucketStart = now
  }

  /**
   * 页面隐藏前调用：停止采样，丢弃未满桶（不可见期间不产生帧，不算进统计）。
   */
  pause(): void {
    this.running = false
  }

  /**
   * 页面重新可见：以当前时刻重启，跳过不可见期间的空档。
   * @param now performance.now() 的当前值
   */
  resume(now: number): void {
    this.lastFrameTime = 0
    this.bucketStart = now
    // 必须清空桶内计数：否则 pause 前的帧会被算进 resume 后的第一个样本
    this.framesInBucket = 0
    this.running = true
  }

  /**
   * 记录一帧。回调内只做一次减法与两次比较，不做 DOM / 字符串 / 对象分配。
   * @param now performance.now() 的当前值
   */
  onFrame(now: number): void {
    if (!this.running) return

    if (this.lastFrameTime > 0) {
      const delta = now - this.lastFrameTime
      // 只统计正常帧间隔；>1s 是 pause 后的空档或长任务，不属于「帧」的范畴
      if (delta > 0 && delta < MAX_FRAME_MS) {
        this.totalFrames++
        if (delta > this.maxFrameDuration) this.maxFrameDuration = delta
        if (delta > DROP_THRESHOLD_MS) this.droppedFrames++
      }
    }
    this.lastFrameTime = now

    this.framesInBucket++
    const bucketElapsed = now - this.bucketStart
    if (bucketElapsed >= BUCKET_MS) {
      this.samples.push(this.framesInBucket / (bucketElapsed / 1000))
      this.framesInBucket = 0
      this.bucketStart = now
    }
  }

  /**
   * 结算：一个完整样本都没采到时返回 null（不上报 0）。
   */
  finalize(): FpsResult | null {
    if (this.samples.length === 0) {
      return null
    }
    const sum = this.samples.reduce((acc, v) => acc + v, 0)
    return {
      avgFps: Math.round((sum / this.samples.length) * 100) / 100,
      dropRate:
        this.totalFrames === 0
          ? 0
          : Math.round((this.droppedFrames / this.totalFrames) * 10000) / 10000,
      maxFrameDuration: Math.round(this.maxFrameDuration),
      sampleCount: this.samples.length
    }
  }
}
