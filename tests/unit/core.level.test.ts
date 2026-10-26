// 严重级别推导测试（规格书 6.3 第 4 步）：级别由模块声明 + 类型兜底共同决定，
// 语义对齐 Sentry 的 event level（fatal / error / warning / info / debug）。
import { describe, expect, it } from 'vitest'
import { Pipeline, type PipelineDeps, type QueuedRaw } from '../../src/core/pipeline'
import { ReportQueue } from '../../src/core/queue'
import { resolveConfig } from '../../src/core/config'
import { behaviorsOf } from '../../src/contracts/emitter'
import { errorModule } from '../../src/modules/error'
import { networkModule } from '../../src/modules/network'
import { memoryModule } from '../../src/modules/memory'
import { performanceModule } from '../../src/modules/performance'
import type { CustomLog, ErrorData, NetworkData, ReportLog } from '../../src/contracts/log'

function build(user = {}) {
  const config = resolveConfig({
    appId: 'a',
    reportUrl: 'https://report.example.com/u',
    modules: ['error', 'performance', 'network', 'memory'],
    ...user
  })
  const queue = new ReportQueue(config.maxLogsPerPage, makeNotice)
  const lazyItems: QueuedRaw[] = []
  const deps: PipelineDeps = {
    config,
    queue,
    counters: { sampledOut: 0, dropped: 0, failed: 0 },
    behaviors: behaviorsOf({
      error: errorModule,
      network: networkModule,
      memory: memoryModule,
      performance: performanceModule
    }),
    getCommon: () => ({ tags: {}, extra: {} }),
    getPageSnapshot: () => ({ url: 'https://example.com/p', path: '/p' }),
    getNavigationType: () => 'navigate',
    getUa: () => 'test-ua',
    getSessionId: () => 'sess-1',
    lazyPush: (raw) => lazyItems.push(raw)
  }
  return { queue, pipeline: new Pipeline(deps), config }
}

function makeNotice(count: number): CustomLog {
  return {
    appId: 'a',
    type: 'custom',
    schemaVersion: 1,
    sdkVersion: '1.0.0',
    env: 'production',
    timestamp: Date.now(),
    timeOriginCorrected: 0,
    pageUrl: 'https://example.com/p',
    pagePath: '/p',
    navigationType: 'navigate',
    ua: 'test-ua',
    sessionId: 's',
    data: { event: 'logs_dropped', count }
  }
}

function errorData(over: Partial<ErrorData> = {}): ErrorData {
  return {
    errorType: 'js_error',
    message: 'boom',
    count: 1,
    firstSeen: Date.now(),
    lastSeen: Date.now(),
    ...over
  }
}

function networkData(over: Partial<NetworkData> = {}): NetworkData {
  return {
    reqUrl: 'https://api.example.com/x',
    reqMethod: 'GET',
    reqStartTime: 0,
    reqDuration: 10,
    resOk: true,
    aborted: false,
    ...over
  }
}

/** 取出队首日志的 level。 */
function levelOfFirst(queue: ReportQueue): string | undefined {
  const list = queue.drainAll()
  return (list[0] as ReportLog | undefined)?.level
}

describe('严重级别推导', () => {
  it('JS 错误默认 error', () => {
    const { pipeline, queue } = build()
    pipeline.process('error', errorData())
    expect(levelOfFirst(queue)).toBe('error')
  })

  it('chunk 加载失败升为 fatal', () => {
    const { pipeline, queue } = build()
    pipeline.process('error', errorData({ message: 'Loading chunk 123 failed.' }))
    expect(levelOfFirst(queue)).toBe('fatal')
  })

  it('资源错误按标签分级：script → error，img → warning', () => {
    const a = build()
    a.pipeline.process('error', errorData({ errorType: 'resource_error', resourceType: 'script' }))
    expect(levelOfFirst(a.queue)).toBe('error')

    const b = build()
    b.pipeline.process('error', errorData({ errorType: 'resource_error', resourceType: 'img' }))
    expect(levelOfFirst(b.queue)).toBe('warning')
  })

  it('网络：5xx → error，404 → warning，取消 → info', () => {
    const a = build()
    a.pipeline.process('network', networkData({ resOk: false, statusCategory: 'server_error' }))
    expect(levelOfFirst(a.queue)).toBe('error')

    const b = build()
    b.pipeline.process('network', networkData({ resOk: false, statusCategory: 'not_found' }))
    expect(levelOfFirst(b.queue)).toBe('warning')

    const c = build()
    c.pipeline.process('network', networkData({ aborted: true, statusCategory: 'aborted' }))
    expect(levelOfFirst(c.queue)).toBe('info')
  })

  it('性能：poor 评级 → warning，其余 info', () => {
    const a = build()
    a.pipeline.process('performance', {
      metricName: 'LCP',
      value: 5000,
      rating: 'poor',
      entryType: 'largest-contentful-paint',
      startTime: 0
    })
    expect(levelOfFirst(a.queue)).toBe('warning')

    const b = build()
    b.pipeline.process('performance', {
      metricName: 'LCP',
      value: 1000,
      rating: 'good',
      entryType: 'largest-contentful-paint',
      startTime: 0
    })
    expect(levelOfFirst(b.queue)).toBe('info')
  })

  it('内存：高占用 → warning，低占用 → info', () => {
    const base = {
      usedJSHeapSize: 1,
      totalJSHeapSize: 2,
      jsHeapSizeLimit: 100,
      sampleIndex: 0,
      deltaBytes: null,
      growthPerMinute: null
    }
    const a = build()
    a.pipeline.process('memory', { ...base, usageRate: 0.9 })
    expect(levelOfFirst(a.queue)).toBe('warning')

    const b = build()
    b.pipeline.process('memory', { ...base, usageRate: 0.2 })
    expect(levelOfFirst(b.queue)).toBe('info')
  })

  it('自定义上报未声明级别时兜底 info', () => {
    const { pipeline, queue } = build()
    pipeline.process('custom', { event: 'checkout_success' })
    expect(levelOfFirst(queue)).toBe('info')
  })

  it('beforeSend 可以覆写 level（业务最清楚某条错误意味着什么）', () => {
    const { pipeline, queue } = build({
      beforeSend: (log: ReportLog) => ({ ...log, level: 'fatal' as const })
    })
    pipeline.process('error', errorData())
    expect(levelOfFirst(queue)).toBe('fatal')
  })

  it('没有模块声明时按类型兜底（未注册 network 模块）', () => {
    const config = resolveConfig({
      appId: 'a',
      reportUrl: 'https://report.example.com/u',
      modules: ['network']
    })
    const queue = new ReportQueue(config.maxLogsPerPage, makeNotice)
    const pipeline = new Pipeline({
      config,
      queue,
      counters: { sampledOut: 0, dropped: 0, failed: 0 },
      behaviors: {},
      getCommon: () => ({ tags: {}, extra: {} }),
      getPageSnapshot: () => ({ url: 'https://example.com/p', path: '/p' }),
      getNavigationType: () => 'navigate',
      getUa: () => 'test-ua',
      getSessionId: () => 'sess-1'
    })
    pipeline.process('network', networkData({ resOk: false, statusCategory: 'server_error' }))
    expect(levelOfFirst(queue)).toBe('info')
  })
})
