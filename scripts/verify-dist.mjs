import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const errors = []

if (!fs.existsSync(dist)) {
  console.error('x dist 目录不存在，请先执行 npm run build')
  process.exit(1)
}

for (const field of ['main', 'module', 'types', 'unpkg', 'jsdelivr']) {
  const value = pkg[field]
  if (!value) continue
  if (!fs.existsSync(path.join(root, value))) errors.push(`${field} 指向的 ${value} 不存在`)
}

function walkExports(key, value) {
  if (typeof value === 'string') {
    if (value.startsWith('./') && !fs.existsSync(path.join(root, value))) {
      errors.push(`exports["${key}"] 指向的 ${value} 不存在`)
    }
    return
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) walkExports(key ? `${key}.${k}` : k, v)
  }
}

for (const [k, v] of Object.entries(pkg.exports || {})) walkExports(k, v)

const REFERENCE_PATTERNS = [
  /from\s*["'](\.\/[^"']+)["']/g,
  /require\(\s*["'](\.\/[^"']+)["']\s*\)/g,
  /import\(\s*["'](\.\/[^"']+)["']\s*\)/g
]

const bundleFiles = fs.readdirSync(dist).filter((f) => /\.(js|cjs|mjs)$/.test(f))

for (const file of bundleFiles) {
  const source = fs.readFileSync(path.join(dist, file), 'utf8')
  for (const pattern of REFERENCE_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      if (!fs.existsSync(path.join(dist, match[1]))) {
        errors.push(`${file} 引用了不存在的 ${match[1]}`)
      }
    }
  }
}

const entryCount = Object.keys(pkg.exports || {}).filter((k) => k !== './package.json').length

if (errors.length > 0) {
  console.error('x 产物完整性校验失败：')
  for (const message of [...new Set(errors)]) console.error(`  - ${message}`)
  process.exit(1)
}

console.log(`ok 产物完整性校验通过：${bundleFiles.length} 个 bundle、${entryCount} 个入口、${fs.readdirSync(dist).length} 个文件`)
