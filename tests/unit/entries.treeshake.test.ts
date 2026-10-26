// 树摇/子路径产物断言（规格书第 11 章 entries.treeshake.test.ts）：构建后字符串检索。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { ensureDist } from '../helpers/distBuild'

const root = process.cwd()
const dist = join(root, 'dist')

/** 读取入口与其 chunk 依赖闭包的全部内容（ESM 产物做了代码分割）。 */
function readBundle(name: string): string {
  const visited = new Set<string>()
  let content = ''

  const collect = (file: string): void => {
    if (visited.has(file)) return
    visited.add(file)
    const text = readFileSync(join(dist, file), 'utf8')
    content += '\n' + text
    for (const match of text.matchAll(/from"\.\/(chunk-[^"]+\.js)"/g)) {
      const dep = match[1]
      if (dep) collect(dep)
    }
  }
  collect(name)
  return content
}

describe('子路径构建产物（tree-shaking）', () => {
  beforeAll(async () => {
    // 与 artifact.acceptance 等文件并行调用，靠文件锁串行化，避免并发 tsup 写坏 dist
    await ensureDist()
  }, 180000)

  it('dist/error.js 不含 MemoryMonitor / NetworkMonitor 相关符号', () => {
    const bundle = readBundle('error.js')
    expect(bundle).not.toContain('MemoryMonitor')
    expect(bundle).not.toContain('NetworkMonitor')
    // 属性名不会被压缩混淆，作为符号检索的补充（内存/网络模块专属字段）
    expect(bundle).not.toContain('growthPerMinute')
    expect(bundle).not.toContain('usedJSHeapSize')
    expect(bundle).not.toContain('XMLHttpRequest')
  })

  it('dist/performance.js 不含 MemoryMonitor 相关符号', () => {
    const bundle = readBundle('performance.js')
    expect(bundle).not.toContain('MemoryMonitor')
    expect(bundle).not.toContain('growthPerMinute')
    expect(bundle).not.toContain('XMLHttpRequest')
  })

  it('dist/memory.js 不含 ErrorMonitor / normalizeMessage 相关符号', () => {
    const bundle = readBundle('memory.js')
    expect(bundle).not.toContain('ErrorMonitor')
    expect(bundle).not.toContain('normalizeMessage')
    expect(bundle).not.toContain('largest-contentful-paint')
    expect(bundle).not.toContain('XMLHttpRequest')
  })

  it('全量入口包含错误与性能模块符号', () => {
    const bundle = readBundle('index.js')
    expect(bundle).toContain('largest-contentful-paint')
    expect(bundle).toContain('unhandledrejection')
  })
})