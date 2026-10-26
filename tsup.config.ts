import { defineConfig } from 'tsup'
import pkg from './package.json'
// 入口清单与 package.json#exports 共用同一份声明（scripts/entries.mjs），不再各写一份。
// 新增子路径入口：改 scripts/entries.mjs 后执行 npm run gen:entries。
import { ENTRIES } from './scripts/entries.mjs'

export default defineConfig({
  entry: ENTRIES,
  format: ['esm', 'cjs', 'iife'],
  globalName: 'MonitorReport',
  dts: true,
  sourcemap: true,
  minify: true,
  target: 'es2018',
  platform: 'browser',
  clean: true,
  define: {
    __SDK_VERSION__: JSON.stringify(pkg.version)
  }
})
