// 队列单元测试：限额丢弃（丢最旧）、droppedCount、批次尾丢弃通知（对应规格书
// 第 11 章 core.pipeline.test.ts 中的限额与丢弃用例所依赖的队列行为）。
import { describe, expect, it } from 'vitest'
import { ReportQueue } from '../../src/core/queue'
import type { CustomLog, ReportLog } from '../../src/contracts/log'

function makeLog(id: number): ReportLog {
  return {
    appId: 'a',
    type: 'custom',
    schemaVersion: 1,
    sdkVersion: '1.0.0',
    env: 'production',
    timestamp: id,
    timeOriginCorrected: 0,
    pageUrl: 'https://example.com/',
    pagePath: '/',
    navigationType: 'navigate',
    ua: 'ua',
    sessionId: 's',
    data: { id }
  }
}

function makeNotice(count: number): CustomLog {
  return {
    appId: 'a',
    type: 'custom',
    schemaVersion: 1,
    sdkVersion: '1.0.0',
    env: 'production',
    timestamp: 0,
    timeOriginCorrected: 0,
    pageUrl: 'https://example.com/',
    pagePath: '/',
    navigationType: 'navigate',
    ua: 'ua',
    sessionId: 's',
    data: { event: 'logs_dropped', count }
  }
}

describe('ReportQueue', () => {
  it('超限时丢弃最旧一条并累加 droppedCount', () => {
    const q = new ReportQueue(3, makeNotice)
    q.add(makeLog(1))
    q.add(makeLog(2))
    q.add(makeLog(3))
    q.add(makeLog(4))
    q.add(makeLog(5))
    expect(q.size).toBe(3)
    expect(q.droppedCount).toBe(2)
    const logs = q.drainAll() as Array<ReportLog & { data: { id?: number } }>
    // 批次尾为 logs_dropped 通知日志（data 无 id），取前 3 条验证保序
    expect(logs.slice(0, 3).map((l) => l.data.id)).toEqual([3, 4, 5])
    expect(logs[3]?.type).toBe('custom')
  })

  it('drainAll 在批次末尾追加 logs_dropped 通知并清零计数', () => {
    const q = new ReportQueue(2, makeNotice)
    q.add(makeLog(1))
    q.add(makeLog(2))
    q.add(makeLog(3))
    const drained = q.drainAll()
    expect(drained.length).toBe(3)
    const tail = drained[2] as CustomLog
    expect(tail.type).toBe('custom')
    expect(tail.data.event).toBe('logs_dropped')
    expect(tail.data.count).toBe(1)
    expect(q.droppedCount).toBe(0)
    expect(q.drainAll().length).toBe(0)
  })

  it('prepend 回塞队首且保持传入顺序', () => {
    const q = new ReportQueue(10, makeNotice)
    q.add(makeLog(3))
    q.prepend([makeLog(1), makeLog(2)])
    const drained = q.drainAll() as Array<ReportLog & { data: { id?: number } }>
    expect(drained.map((l) => l.data.id)).toEqual([1, 2, 3])
  })

  it('clear 清空缓存与计数', () => {
    const q = new ReportQueue(1, makeNotice)
    q.add(makeLog(1))
    q.add(makeLog(2))
    q.clear()
    expect(q.size).toBe(0)
    expect(q.droppedCount).toBe(0)
  })
})