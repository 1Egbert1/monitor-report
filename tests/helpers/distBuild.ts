// 测试期产物构建闸门：多个测试文件都会触发 `tsup`，vitest 默认并行跑文件，
// 并发构建会同时清空/写入 dist，产出残缺产物（曾导致 dist 只剩 37 个文件、index.js 消失）。
// 这里用文件锁把构建串行化，并复用已完整的产物。
import { execSync } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const lockDir = join(root, 'node_modules', '.cache', 'monitor-report')
const lockPath = join(lockDir, 'dist-build.lock')

/** 锁等待上限：CI 上首次构建（含冷 cache）约 6s，留足余量。 */
const LOCK_TIMEOUT_MS = 180_000

/**
 * 判断现有产物是否完整可用（与 scripts/verify-dist.mjs 同源的口径）。
 * @returns 所有 exports 目标及其 sourcemap 均存在时为 true
 */
function isDistComplete(): boolean {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    exports: Record<string, string | Record<string, string>>
  }
  const targets: string[] = []
  for (const value of Object.values(pkg.exports)) {
    if (typeof value === 'string') {
      targets.push(value)
      continue
    }
    for (const p of Object.values(value)) {
      if (p.startsWith('./')) targets.push(p)
    }
  }
  for (const target of targets) {
    if (!existsSync(join(root, target))) return false
    if (target.endsWith('.js') && !existsSync(join(root, `${target}.map`))) return false
  }
  return targets.length > 0
}

/** 等待一小段时间（避免忙等烧 CPU）。 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 确保 dist 可用：拿锁 → 检查完整性 → 必要时构建 → 释放锁。
 * 多个测试文件并发调用时，只有一个真正执行构建，其余等它完成后直接复用。
 */
export async function ensureDist(): Promise<void> {
  mkdirSync(lockDir, { recursive: true })
  const deadline = Date.now() + LOCK_TIMEOUT_MS

  let fd = -1
  while (fd < 0) {
    try {
      fd = openSync(lockPath, 'wx')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
      // 持锁进程异常退出会留下僵尸锁：超过 2 分钟未变动则强制接管
      if (Date.now() - statSync(lockPath).mtimeMs > 120_000) {
        try {
          unlinkSync(lockPath)
        } catch {
          // 并发删除：忽略
        }
        continue
      }
      if (Date.now() > deadline) {
        throw new Error('等待 dist 构建锁超时：另一进程可能卡在 tsup')
      }
      await sleep(100)
    }
  }

  try {
    if (!isDistComplete()) {
      execSync('npx tsup', { cwd: root, stdio: 'ignore' })
    }
  } finally {
    closeSync(fd)
    try {
      unlinkSync(lockPath)
    } catch {
      // 已被清理：忽略
    }
  }
}
