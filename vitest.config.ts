import { defineConfig } from 'vitest/config'

export default defineConfig({
  define: {
    __SDK_VERSION__: '"1.0.0"'
  },
  test: {
    environment: 'happy-dom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/unit/**/*.test.ts', 'tests/acceptance/**/*.test.ts'],
    // T-01 阶段尚无测试文件，允许 ci 全绿；后续任务新增用例后自然生效
    passWithNoTests: true,
    coverage: {
      // SPEC-GAP: 规格书 2.2 依赖白名单未列出覆盖率 provider，但第 11 章要求 statements≥80/branches≥70，
      // 因此补充开发期依赖 @vitest/coverage-v8（测试专用，不影响 0 运行时依赖约束）。
      provider: 'v8',
      statements: 80,
      branches: 70,
      functions: 80,
      lines: 80,
      include: ['src/**/*.ts']
    }
  }
})