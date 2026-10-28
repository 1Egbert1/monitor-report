# @yakult001/monitor-report

轻量级前端监控 SDK：错误、性能、网络、内存四类采集。零依赖、8 个按需入口，`core + error` brotli 后仅 7.7 kB。

## 特性

- **错误**：JS 错误 / Promise 未处理 / 资源错误 / Vue / React ErrorBoundary，附行为栈（click / input / route / console）
- **性能**：FCP / LCP / FID / INP / CLS 五项 Web Vitals + LT（长任务）+ FPS（帧率）
- **网络**：fetch / XHR，11 类状态码分类
- **内存**：JS 堆用量采样，疑似泄漏告警
- 零依赖、按需引入、SSR 安全、支持卸载兜底上报

## 安装

```bash
npm install @yakult001/monitor-report
```

或 CDN 引入 UMD 产物（全局变量 `MonitorReport`）：

```html
<script src="https://unpkg.com/@yakult001/monitor-report/dist/index.global.js"></script>
<script>
  MonitorReport.createMonitor({ appId: 'demo', reportUrl: '/api/upload' })
</script>
```

## 快速开始

```ts
import { createMonitor } from '@yakult001/monitor-report'

const monitor = createMonitor({
  appId: 'project-web-001',
  reportUrl: 'https://report.example.com/api/upload',
  env: 'production',
  modules: ['error', 'performance', 'network'],
  release: '1.2.0'
})

requestIdleCallback(() => monitor.startReport()) // 首屏稳定后启动
```

### 按需引入（体积敏感场景）

```ts
import { createMonitor } from '@yakult001/monitor-report/error'       // core + 错误
import { createMonitor } from '@yakult001/monitor-report/performance' // core + 性能
import { createMonitor } from '@yakult001/monitor-report/network'     // core + 网络
import { createMonitor } from '@yakult001/monitor-report/memory'      // core + 内存
```

### 实例 API

```ts
monitor.addReport('custom', { event: 'checkout_success' }) // 自定义上报
monitor.setUser('uid-001')     // 用户标识
monitor.setTag('page', 'home') // 标签
monitor.setTraceId('trace-abc')// 链路 ID
monitor.setExtra({ from: 'landing_page' })
monitor.flushReport()          // 立即上报
monitor.getStatus()            // { queued, dropped, failed, disabled }
monitor.destroy()              // 销毁（默认先 flush）
```

## 采集指标

| 模块 | 指标 |
| --- | --- |
| error | JS 错误 / Promise 未处理 / 资源错误 / Vue / React，附行为栈 |
| performance | FCP / LCP / FID / INP / CLS（Web Vitals）+ LT / FPS（诊断） |
| network | fetch / XHR，状态码分类 |
| memory | JS 堆用量 |

性能指标默认在页面隐藏时结算（拿到终值），每项只上报一次。

## 常用配置

| 配置 | 说明 |
| --- | --- |
| `appId` | 应用标识（必填） |
| `reportUrl` | 上报地址（与 `request` 二选一） |
| `modules` | 启用的模块，默认全部 |
| `env` | `production` / `development` / `test` |
| `release` | 发布版本号 |
| `sample` | 分模块采样率，如 `{ error: 1, performance: 0.1 }` |
| `lazyReport` | 延迟上报，配合 `startReport()` 使用 |
| `ignoreErrors` | 忽略的错误（字符串或正则） |
| `maskQueryKeys` | 需要脱敏的 URL 查询参数 |
| `beforeSend` | 上报前改写 / 丢弃日志 |
| `request` / `unloadRequest` | 自定义传输（替换内置逻辑） |
| `performance.fpsEnabled` | 采集 FPS（默认关，`fpsSampleDurationMs` 控制时长） |
| `network.collectResourceTiming` | 采集资源耗时 |

## 框架集成

SDK 不依赖框架，框架错误通过适配插件接管。

**Vue 3 / Vue 2**

```ts
import { vueErrorPlugin } from '@yakult001/monitor-report/vue3' // vue2 用 /vue2
app.use(vueErrorPlugin, { monitor }) // Vue 2：Vue.use(...)
```

**React**

```tsx
import { createErrorBoundary } from '@yakult001/monitor-report/react'

const Boundary = createErrorBoundary(React, monitor)

<Boundary fallback={<ErrorPage />}>
  <App />
</Boundary>
```

Boundary 只捕获渲染 / 生命周期错误，事件处理器与异步错误走全局通道（`window.onerror` / `unhandledrejection`）——两条路互补，React 项目两种都要接。

## 日志级别

每条日志带 `level`，对齐 Sentry event level：`fatal / error / warning / info / debug`。级别由采集侧确定性推导，无需逐条标注。

| 来源 | level |
| --- | --- |
| chunk 加载失败的 JS 错误 | `fatal` |
| JS 错误 / Promise 未处理 / Vue 组件错误 / 接口 5xx / 超时 | `error` |
| 资源错误（图片等）/ 接口 4xx / 重定向 | `warning` |
| 接口 2xx / 取消 / 性能指标 / 自定义上报 | `info` |

## 网络状态码分类

网络日志带 `statusCategory`，避免把一切失败渲染成「接口异常」：`success / redirect / bad_request / unauthorized / forbidden / not_found / client_error / server_error / timeout / aborted / network_error`。

## 部署注意

- **SSR / Nuxt**：只在 client 侧初始化（构造函数已做环境守卫，非浏览器环境降级为 no-op）。
- **跨域脚本错误**：给 `<script>` 加 `crossorigin` 且 CDN 返回 `Access-Control-Allow-Origin`，否则退化为 `Script error.`。
- **sendBeacon 鉴权**：卸载上报降级为 `sendBeacon` 时无法携带自定义请求头，鉴权信息请放 body 或 URL（或用 `extra.token`）。

## 已知边界

1. `performance.memory` 仅 Chromium 有效，只覆盖 JS 堆。
2. 自定义 `request` 时失去内置卸载兜底，需自行实现 `unloadRequest`。
3. 本期不做会话回放、路径回溯、Source Map 反解、白屏检测。

## License

[MIT](./LICENSE)
