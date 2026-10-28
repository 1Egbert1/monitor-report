// 在 prepack / postpack 之间切换 README，实现「GitHub 完整版 + npm 精简版」。
//
// prepack（无参）：把完整版 README.md 备份，用精简版 README.npm.md 覆盖
// postpack（--restore）：恢复完整版
//
// 备份文件以 . 开头，npm 不会打包，也不进 git（见 .gitignore）。
import { copyFileSync, existsSync, renameSync, rmSync } from 'node:fs'

const FULL = 'README.md'
const NPM = 'README.npm.md'
const BACKUP = '.README.full.md.bak'

const restore = process.argv.includes('--restore')

if (restore) {
  if (existsSync(BACKUP)) {
    rmSync(FULL, { force: true })
    renameSync(BACKUP, FULL)
    console.log('[readme] 已恢复完整版 README.md')
  } else {
    console.log('[readme] 无备份，跳过恢复')
  }
} else {
  if (existsSync(BACKUP)) {
    console.log('[readme] 检测到遗留备份（上次打包可能被中断），跳过切换')
  } else {
    renameSync(FULL, BACKUP)
    copyFileSync(NPM, FULL)
    console.log('[readme] 已切换为 npm 精简版 README.md')
  }
}
