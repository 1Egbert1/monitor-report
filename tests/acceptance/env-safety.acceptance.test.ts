// 验收用例（规格书第 12 章）· 环境安全部分：AC-01 / AC-02 / AC-03 / AC-07。
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMonitor } from '../../src/index'

const root = process.cwd()
const srcDir = join(root, 'src')

/** 递归收集目录下所有 .ts 源码。 */
function collectTs(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      collectTs(full, out)
    } else if (entry.name.endsWith('.ts')) {
      out.push(full)
    }
  }
  return out
}

/** 读取源码中非注释行。 */
function codeLines(file: string): string[] {
  const text = readFileSync(file, 'utf8')
  return text
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, ''))
    .filter((line) => line.trim() !== '')
}

describe('AC-01 非浏览器环境初始化不抛错、不上报', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    delete window.__MONITOR_REPORT__
  })

  it('isBrowser=false 时静默降级', () => {
    vi.stubGlobal('window', undefined)
    const monitor = createMonitor({ appId: 'a', reportUrl: 'https://r.example.com/u' })
    expect(monitor.getStatus()).toEqual({ queued: 0, dropped: 0, failed: 0, disabled: true })
    expect(() => {
      monitor.addReport('custom', { x: 1 })
      monitor.flushReport()
      monitor.startReport()
      monitor.destroy()
    }).not.toThrow()
  })
})

describe('AC-02 未使用 unload / beforeunload（源码检索）', () => {
  it('源码中不存在 unload / beforeunload 事件注册', () => {
    for (const file of collectTs(srcDir)) {
      for (const line of codeLines(file)) {
        expect(line, `${file} 中出现禁用事件: ${line}`).not.toMatch(
          /addEventListener\(\s*['"](unload|beforeunload)['"]/
        )
      }
    }
  })
})

describe('AC-03 未赋值 window.onerror', () => {
  it('源码无 window.onerror 赋值', () => {
    for (const file of collectTs(srcDir)) {
      for (const line of codeLines(file)) {
        expect(line, `${file} 中赋值 window.onerror: ${line}`).not.toMatch(/window\.onerror\s*=/)
      }
    }
  })

  it('初始化错误监控后 window.onerror 仍为 null', () => {
    delete window.__MONITOR_REPORT__
    const monitor = createMonitor({
      appId: 'a',
      reportUrl: 'https://r.example.com/u',
      modules: ['error']
    })
    expect(window.onerror).toBeNull()
    monitor.destroy()
  })
})

describe('AC-07 modules/* 不 import core/*（依赖方向）', () => {
  it('modules 目录下无对 core 的引用', () => {
    const modulesDir = join(srcDir, 'modules')
    for (const file of collectTs(modulesDir)) {
      for (const line of codeLines(file)) {
        expect(line, `${file} 反向依赖 core: ${line}`).not.toMatch(/from\s+['"]\.\.?\/[^'"]*core\/[^'"]*['"]/)
      }
    }
  })
})