// 从 scripts/entries.mjs 派生 package.json#exports，避免入口在三个地方各写一份。
// 用法：
//   node scripts/gen-entries.mjs          写入 package.json
//   node scripts/gen-entries.mjs --check  仅校验是否漂移（CI 用，漂移则退出码 1）
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildExports } from './entries.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkgPath = join(root, 'package.json')
const raw = readFileSync(pkgPath, 'utf8')
const pkg = JSON.parse(raw)
const expected = buildExports()
const actual = pkg.exports ?? {}

const check = process.argv.includes('--check')

if (check) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a !== b) {
    console.error('[gen-entries] package.json#exports 与 scripts/entries.mjs 不一致')
    console.error('  实际:', a)
    console.error('  期望:', b)
    console.error('  请执行 npm run gen:entries 后提交')
    process.exit(1)
  }
  console.log('ok exports 与入口清单一致')
  process.exit(0)
}

pkg.exports = expected
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
console.log('ok 已写入 package.json#exports（入口数 %d）', Object.keys(expected).length - 1)
