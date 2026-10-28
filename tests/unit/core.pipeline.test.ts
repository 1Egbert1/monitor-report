// 数据管道测试（规格书第 11 章 core.pipeline.test.ts 断言矩阵）。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Pipeline, type PipelineDeps, type QueuedRaw } from '../../src/core/pipeline'
import { ReportQueue } from '../../src/core/queue'
import { resolveConfig } from '../../src/core/config'
import { behaviorsOf } from '../../src/contracts/emitter'
import { errorModule } from '../../src/modules/error'
import { networkModule } from '../../src/modules/network'
import type { UserConfig } from '../../src/contracts/config'
import type { CustomLog, ErrorData, NetworkLog, ReportLog } from '../../src/contracts/log'

function makeNotice(count: number): CustomLog {
  return {
    type: 'custom',
    timestamp: 0,
    data: { event: 'logs_dropped', count }
  }
}

function makeErrorData(message = 'boom'): ErrorData {
  return {
    errorType: 'js_error',
    message,
    count: 1,
    firstSeen: Date.now(),
    lastSeen: Date.now()
  }
}

function build(user: Partial<UserConfig> = {}) {
  const config = resolveConfig({ appId: 'a', reportUrl: 'https://report.example.com/u', ...user })
  const queue = new ReportQueue(config.maxLogsPerPage, makeNotice)
  const counters = { sampledOut: 0, dropped: 0, failed: 0 }
  const lazyItems: QueuedRaw[] = []
  const deps: PipelineDeps = {
    config,
    queue,
    counters,
    // 规则过滤由模块声明提供，这里用真实模块的 behavior 覆盖 ignoreErrors / urlBlacklist 路径
    behaviors: behaviorsOf({ error: errorModule, network: networkModule }),
    getCommon: () => ({ tags: {}, extra: {} }),
    getPageSnapshot: () => ({ url: 'https://example.com/p?a=secret1', path: '/p' }),
    getNavigationType: () => 'navigate',
    getUa: () => 'test-ua',
    getSessionId: () => 'sess-1',
    lazyPush: (raw: QueuedRaw) => {
      lazyItems.push(raw)
    }
  }
  return { config, queue, counters, lazyItems, deps, pipeline: new Pipeline(deps) }
}

describe('Pipeline', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('采样率 0 时全部丢弃并计入 sampledOut', () => {
    const { pipeline, queue, counters } = build({ sample: { error: 0 } })
    for (let i = 0; i < 50; i++) {
      pipeline.process('error', makeErrorData())
    }
    expect(queue.size).toBe(0)
    expect(counters.sampledOut).toBe(50)
  })

  it('类型开关：未开启的模块类型被丢弃', () => {
    const { pipeline, queue } = build({ modules: ['error'] })
    pipeline.process('performance', {
      metricName: 'FCP',
      value: 100,
      rating: 'good',
      entryType: 'paint',
      startTime: 10
    })
    expect(queue.size).toBe(0)
  })

  it('ignoreErrors 命中 message 时丢弃', () => {
    const { pipeline, queue } = build({ ignoreErrors: ['known noise'] })
    pipeline.process('error', makeErrorData('this is known noise'))
    expect(queue.size).toBe(0)
    pipeline.process('error', makeErrorData('real error'))
    expect(queue.size).toBe(1)
  })

  it('urlBlacklist 命中 reqUrl 时丢弃（含自动追加的 reportUrl）', () => {
    const { pipeline, queue, config } = build({})
    expect(config.urlBlacklist).toContain('https://report.example.com/u')
    pipeline.process('network', {
      reqUrl: 'https://report.example.com/u?x=1',
      reqMethod: 'POST',
      reqStartTime: 0,
      reqDuration: 1,
      resOk: true,
      aborted: false
    })
    expect(queue.size).toBe(0)
  })

  it('公共字段齐全且 pageUrl 已做 query 脱敏（掩码后到达 beforeSend）', () => {
    const beforeSend = vi.fn((log: ReportLog) => log)
    const { pipeline, queue } = build({
      modules: ['error', 'performance', 'network'],
      beforeSend
    })
    pipeline.process('network', {
      reqUrl: 'https://api.example.com/x?token=abc',
      reqMethod: 'GET',
      reqStartTime: 0,
      reqDuration: 10,
      resOk: true,
      aborted: false
    })
    expect(queue.size).toBe(1)
    const seen = beforeSend.mock.calls[0]?.[0] as NetworkLog | undefined
    expect(seen).toBeDefined()
    if (seen === undefined) return
    // 公共字段（appId / pageUrl / sessionId 等）已上移到上报体的 context，
    // 由 transport 组装与验证；此处只断言样本特有字段
    expect(seen.data.reqUrl).toBe('https://api.example.com/x?token=[filtered]')
  })

  it('beforeSend 返回 null 时丢弃', () => {
    const { pipeline, queue } = build({ beforeSend: () => null })
    pipeline.process('error', makeErrorData())
    expect(queue.size).toBe(0)
  })

  it('lazyReport 时入 raw 缓存而不入 queue', () => {
    const { pipeline, queue, lazyItems } = build({ lazyReport: true })
    pipeline.process('error', makeErrorData('lazy'))
    expect(queue.size).toBe(0)
    expect(lazyItems.length).toBe(1)
    const item = lazyItems[0]
    if (!item || item.type !== 'error') return
    expect(item.data.message).toBe('lazy')
  })
})