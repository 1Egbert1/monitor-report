import { defineConfig } from 'tsup'
import pkg from './package.json'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    error: 'src/error.ts',
    performance: 'src/performance.ts',
    network: 'src/network.ts',
    memory: 'src/memory.ts',
    // SPEC-GAP: 规格书 7.5 定义了 Vue 插件（D-07）但未定义其构建入口；
    // 补充 vue2/vue3 子路径入口，供 Vue 项目按需引入。
    vue3: 'src/plugins/vue3.ts',
    vue2: 'src/plugins/vue2.ts'
  },
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