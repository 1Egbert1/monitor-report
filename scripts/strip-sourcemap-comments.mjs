// 发布前剥离 sourceMappingURL 注释（prepublishOnly 钩子）。
//
// 为什么需要：
// npm 包不带 .map（见 package.json#files 白名单），但 tsup 构建会在每个 js/cjs 末尾
// 留下 //# sourceMappingURL=xxx.map。只删文件不删注释，浏览器 devtools 会去请求一个
// 不存在的文件并报 404 —— 比完全不提供 sourcemap 更糟。
//
// 只删注释，不删 .map 文件：本地开发仍需要 map 调试，map 通过 Release 附件分发。
// 幂等：重复执行不会破坏文件。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist')

/** 匹配文件末尾的 sourceMappingURL 注释（含其前面的换行）。 */
const TAIL_RE = /\n?\/\/# sourceMappingURL=[^\r\n]*[ \t]*(?:\r?\n)?$/

if (!fs.existsSync(dist)) {
  console.error('x dist 目录不存在，请先执行 npm run build')
  process.exit(1)
}

const targets = fs.readdirSync(dist).filter((f) => /\.(js|cjs)$/.test(f))
let stripped = 0
let untouched = 0

for (const file of targets) {
  const full = path.join(dist, file)
  const src = fs.readFileSync(full, 'utf8')
  if (!TAIL_RE.test(src)) {
    untouched++
    continue
  }
  const next = src.replace(TAIL_RE, '')
  fs.writeFileSync(full, next)
  stripped++
}

console.log(
  `ok 已剥离 sourceMappingURL 注释：${stripped} 个（无注释 ${untouched} 个，共 ${targets.length} 个）`
)
