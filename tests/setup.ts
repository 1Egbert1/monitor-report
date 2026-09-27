// 全局测试环境（规格书第 11 章）：
// 可手动触发 entry 的 PerformanceObserver mock、可拦截的 fetch mock、visibilityState 可控切换。
import { vi } from 'vitest'

/**
 * PerformanceObserver 全局 mock：记录实例，可按 entryType 手动触发回调。
 */
export class MockPerformanceObserver {
  static instances: MockPerformanceObserver[] = []

  callback: PerformanceObserverCallback
  init: PerformanceObserverInit | null = null
  disconnectedCount = 0

  constructor(callback: PerformanceObserverCallback) {
    this.callback = callback
    MockPerformanceObserver.instances.push(this)
  }

  observe(init: PerformanceObserverInit): void {
    this.init = init
  }

  disconnect(): void {
    this.disconnectedCount++
  }

  takeRecords(): PerformanceEntryList {
    return []
  }

  /**
   * 向匹配 entryType 的实例投递条目。
   * @param entryType 目标条目类型
   * @param entries 条目对象数组
   */
  static trigger(entryType: string, entries: Array<Record<string, unknown>>): void {
    for (const inst of MockPerformanceObserver.instances) {
      if (inst.init?.type === entryType) {
        inst.callback(
          { getEntries: () => entries as unknown as PerformanceEntry[] } as PerformanceObserverEntryList,
          inst as unknown as PerformanceObserver
        )
      }
    }
  }

  /** 清空实例记录。 */
  static reset(): void {
    MockPerformanceObserver.instances = []
  }

  /** 取某 entryType 的第一个实例。 */
  static findByType(entryType: string): MockPerformanceObserver | undefined {
    return MockPerformanceObserver.instances.find((i) => i.init?.type === entryType)
  }
}

vi.stubGlobal('PerformanceObserver', MockPerformanceObserver)
// 默认 fetch mock：测试中可按需覆写。
vi.stubGlobal(
  'fetch',
  vi.fn(() => Promise.resolve({ ok: true }))
)

/**
 * 切换 document.visibilityState（只读属性，通过 defineProperty 覆写）。
 * @param state 目标可见性
 */
export function setVisibilityState(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', {
    value: state,
    configurable: true
  })
}