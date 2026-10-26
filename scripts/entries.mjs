// 公开入口的唯一定义处：tsup 构建与 package.json#exports 均由此派生。
// 新增子路径入口：加一行，然后执行 npm run gen:entries。

/** 入口名 → 源文件路径（index 对应包根）。 */
export const ENTRIES = {
  index: 'src/index.ts',
  error: 'src/error.ts',
  performance: 'src/performance.ts',
  network: 'src/network.ts',
  memory: 'src/memory.ts',
  vue3: 'src/plugins/vue3.ts',
  vue2: 'src/plugins/vue2.ts'
}

/**
 * 生成 package.json#exports 字段。
 * @returns exports 映射（含 "." 与 "./package.json"）
 */
export function buildExports() {
  const exportsMap = {}
  for (const name of Object.keys(ENTRIES)) {
    const key = name === 'index' ? '.' : `./${name}`
    exportsMap[key] = {
      types: `./dist/${name}.d.ts`,
      import: `./dist/${name}.js`,
      require: `./dist/${name}.cjs`
    }
  }
  exportsMap['./package.json'] = './package.json'
  return exportsMap
}
