// 验收用例（规格书第 12 章）· 产物与环境清理部分：AC-04 / AC-08 / AC-09 / AC-10 / AC-13 / AC-15。
import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createMonitor } from '../../src/index'
import { PERFORMANCE_OBSERVER_CONFIGS } from '../../src/modules/performance/observers'
import { ensureDist } from '../helpers/distBuild'
import { MockPerformanceObserver } from '../setup'

const root = process.cwd()
const dist = join(root, 'dist')

/** 读取 ESM 产物入口与其 chunk 依赖闭包。 */
function readBundle(file: string): string {
  const visited = new Set<string>()
  let content = ''
  const collect = (f: string): void => {
    if (visited.has(f)) return
    visited.add(f)
    const text = readFileSync(join(dist, f), 'utf8')
    content += '\n' + text
    for (const match of text.matchAll(/from"\.\/(chunk-[^"]+\.js)"/g)) {
      const dep = match[1]
      if (dep) collect(dep)
    }
  }
  collect(file)
  return content
}

describe('AC-04 所有 Observer 带 buffered: true', () => {
  it('全部 PerformanceObserver 构造参数含 buffered', () => {
    delete window.__MONITOR_REPORT__
    MockPerformanceObserver.reset()
    const monitor = createMonitor({
      appId: 'a',
      reportUrl: 'https://r.example.com/u',
      modules: ['performance']
    })
    // 实例数由配置表决定，不写死数字：新增指标时无需改这条断言
    expect(MockPerformanceObserver.instances.length).toBe(PERFORMANCE_OBSERVER_CONFIGS.length)
    for (const inst of MockPerformanceObserver.instances) {
      expect(inst.init?.buffered).toBe(true)
    }
    monitor.destroy()
  })
})

describe('AC-13 destroy() 无残留', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    delete window.__MONITOR_REPORT__
  })

  it('销毁后监听被移除、Observer 全部 disconnect、定时器清空、不再入队', () => {
    delete window.__MONITOR_REPORT__
    MockPerformanceObserver.reset()
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
    const winRemove = vi.spyOn(window, 'removeEventListener')
    const docRemove = vi.spyOn(document, 'removeEventListener')

    const monitor = createMonitor({
      appId: 'a',
      reportUrl: 'https://r.example.com/u',
      modules: ['performance']
    })
    // 触发防抖定时器，验证 destroy 清空
    monitor.addReport('custom', { n: 1 })
    expect(vi.getTimerCount()).toBeGreaterThan(0)

    monitor.destroy()

    expect(winRemove.mock.calls.map((c) => c[0])).toContain('pagehide')
    expect(docRemove.mock.calls.map((c) => c[0])).toContain('visibilitychange')
    expect(MockPerformanceObserver.instances.length).toBeGreaterThan(0)
    for (const inst of MockPerformanceObserver.instances) {
      expect(inst.disconnectedCount).toBeGreaterThanOrEqual(1)
    }
    expect(vi.getTimerCount()).toBe(0)

    monitor.addReport('custom', { n: 2 })
    expect(monitor.getStatus().queued).toBe(0)
  })
})

describe('AC-08 / AC-10 子路径产物与 sourcemap', () => {
  beforeAll(async () => {
    // 与 entries.treeshake 等文件并行调用，靠文件锁串行化，避免并发 tsup 写坏 dist
    await ensureDist()
  }, 180000)

  it('AC-08 dist/error.js 不含其他模块符号', () => {
    const bundle = readBundle('error.js')
    expect(bundle).not.toContain('MemoryMonitor')
    expect(bundle).not.toContain('NetworkMonitor')
    expect(bundle).not.toContain('growthPerMinute')
    expect(bundle).not.toContain('XMLHttpRequest')
  })

  it('AC-10 生产产物带 sourcemap', () => {
    expect(existsSync(join(dist, 'index.js.map'))).toBe(true)
    expect(existsSync(join(dist, 'error.js.map'))).toBe(true)
  })
})

describe('AC-09 / AC-15 工程门槛', () => {
  it('AC-09 size-limit 通过', () => {
    expect(() => execSync('npm run size', { cwd: root, stdio: 'ignore' })).not.toThrow()
  }, 120000)

  it('AC-15 ci 脚本链包含 lint/typecheck/test/build/size', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    const ci = pkg.scripts.ci ?? ''
    for (const step of ['lint', 'typecheck', 'test', 'build', 'size']) {
      expect(ci).toContain(step)
    }
  })
})