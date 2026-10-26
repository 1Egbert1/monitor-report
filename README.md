# monitor-report

前端监控组件：错误 / 性能 / 网络 / 内存各维度采集与上报的轻量 SDK。零运行时依赖，ES2018 目标，支持 ESM / CJS / IIFE 三种产物。

特性：

- 错误监控：JS 错误 / 资源加载失败 / Promise 未处理拒绝三通道采集，归一化指纹 + 计数式去重
- 性能监控：FCP / LCP / FID / INP / CLS，终态上报（Web Vitals 评级）
- 网络监控：fetch / XMLHttpRequest 包装采集（可取消请求不误报），按状态码输出语义分类，400 / 401 / 404 不再混成「接口异常」
- 内存采样：JS 堆增长趋势（独立子路径，仅 Chromium）
- 数据脱敏：URL query / CSS 选择器 / 文本 PII 兜底脱敏（管道内强制执行）
- 体积敏感：按需引入子路径，core + error 约 5.7 kB（minified + brotli）

## 安装

```bash
npm install @yakult001/monitor-report
```

或通过 CDN 直接引入 UMD 产物（全局变量 `MonitorReport`）：

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

// 延迟上报：首屏稳定后启动
requestIdleCallback(() => monitor.startReport())
```

按需引入（体积敏感场景）：

```ts
import { createMonitor } from '@yakult001/monitor-report/error' // 仅 core + 错误采集
import { createMonitor } from '@yakult001/monitor-report/performance' // 仅 core + 性能采集
import { createMonitor } from '@yakult001/monitor-report/network' // 仅 core + 网络采集
import { createMonitor } from '@yakult001/monitor-report/memory' // 仅 core + 内存采样
```

常用实例 API：

```ts
monitor.addReport('custom', { event: 'checkout_success' }) // 自定义上报
monitor.setUser('uid-001') // 设置用户标识
monitor.setTag('page', 'home') // 设置标签
monitor.setTraceId('trace-abc') // 设置链路 ID（透传字段）
monitor.setExtra({ from: 'landing_page' }) // 合并附加数据
monitor.flushReport() // 立即上报
monitor.getStatus() // 自诊断：{ queued, dropped, failed, disabled }
monitor.destroy() // 销毁（默认先 flush）
```

## 日志级别

每条日志带 `level`，取值对齐 Sentry 的 event level（去掉了 `log` 档）：

```ts
type LogLevel = 'fatal' | 'error' | 'warning' | 'info' | 'debug'
```

级别由采集侧按确定性规则推导，**不需要逐条标注**；「某个故障多紧急」属于聚合后的优先级，由上报服务端计算（对齐 Sentry 的 issue priority High / Medium / Low），SDK 不做。

| 来源 | level |
| --- | --- |
| chunk 加载失败引发的 JS 错误 | `fatal` |
| 其他 JS 错误 / Promise 未处理 / Vue 组件错误 | `error` |
| 资源错误（`<script>` 失败） | `error` |
| 资源错误（图片 / 样式 / 媒体） | `warning` |
| 接口 5xx / 超时 / 网络层失败 | `error` |
| 接口 4xx / 重定向 | `warning` |
| 接口 2xx / 请求被取消 | `info` |
| 性能指标（评级 `poor` 时升 `warning`） | `info` |
| 内存采样（高占用或疑似泄漏时升 `warning`） | `info` |
| 自定义上报 | `info`（可由 `beforeSend` 覆写） |

```ts
createMonitor({
  appId: 'demo',
  reportUrl: '/api/upload',
  // 业务最清楚某条日志意味着什么，可以在这里改写级别
  beforeSend: (log) =>
    log.level === 'warning' && log.pagePath.startsWith('/checkout')
      ? { ...log, level: 'fatal' } // 结算链路上的 warning 按致命处理
      : log
})
```

## 网络请求的状态码分类

网络日志除了原始 `resStatus`，还带 `statusCategory` 与 `statusMessage` 两个字段，避免下游把一切失败统一渲染成「接口异常」：

| 状态码 | `statusCategory` | 典型原因 |
| --- | --- | --- |
| 2xx | `success` | —— |
| 3xx | `redirect` | 重定向未被跟随 / 接口地址被改写 |
| 400 | `bad_request` | 前端传参字段或序列化错误 |
| 401 | `unauthorized` | 未登录、token 过期或刷新逻辑失效（前端最高频事故） |
| 403 | `forbidden` | 账号权限不足、白名单或风控拦截 |
| 404 | `not_found` | URL 拼写错误、前后端接口版本不匹配 |
| 405 / 409 / 413 / 422 / 429 | `client_error` | 方法用错 / 并发冲突 / 体积超限 / 校验失败 / 触发限流 |
| 5xx | `server_error` | 后端故障（501 / 502 / 503 / 504 有独立文案） |
| 无状态码且请求失败 | `network_error` | 断网、CORS 拦截、插件阻断 |
| 超时 | `timeout` | 服务端未在约定时间内响应 |
| 主动取消 | `aborted` | `AbortController` / `xhr.abort()`，**不计为失败** |

`resOk` 的判定统一收在内部（2xx 为 `true`，其余为 `false`，取消为 `true`），fetch 与 XHR 两条通道语义一致。需要在自己的上报展示层复用同一套分类时，可以直接引用：

```ts
import { classifyNetworkOutcome } from '@yakult001/monitor-report' // 或 /network 子路径

const out = classifyNetworkOutcome({ resStatus: 401, aborted: false })
// { resOk: false, statusCategory: 'unauthorized', statusMessage: '未登录或凭证已失效（401）…' }
```

## 部署要求

### SSR / Nuxt

SDK 依赖浏览器全局对象，必须只在 client 侧初始化（构造函数已做环境守卫，非浏览器环境会静默降级为 no-op，但请勿在服务端 import 后于模块顶层执行副作用）：

```ts
// plugins/monitor.client.ts —— 只放 client 侧
import { createMonitor } from '@yakult001/monitor-report'

export default defineNuxtPlugin(() => {
  const monitor = createMonitor({ appId: 'nuxt-web', reportUrl: '/api/upload' })
  return { provide: { monitor } }
})
```

### 跨域脚本错误（crossorigin）

浏览器对跨域脚本默认只抛出 `Script error.`（无 message / stack / 行号）。要采集到真实错误信息，业务方必须：

1. 给 `<script>` 加 `crossorigin` 属性（`crossorigin="anonymous"`）；
2. CDN 返回 `Access-Control-Allow-Origin` 响应头。

否则 SDK 只能上报 `crossOrigin: true`、`fileName: 'unknown-cross-origin'` 的降级信息。

### sendBeacon 鉴权限制

卸载上报的优先链路是 `fetch(..., { keepalive: true })`（可携带自定义请求头）；当批次体积超过 60KB 或 keepalive 不可用时降级为 `navigator.sendBeacon`，**该路径无法携带自定义请求头**。如后端依赖鉴权信息，请：

- 使用 `extra: { token: '...' }` 配置 token —— SDK 会把它随体放在上报体顶层 `token` 字段，两种传输路径均可用；
- 或在下载路径之外自行保证鉴权在 body / URL 中。

> `requestConfig.headers` 只作用于常规上报与 keepalive 路径；sendBeacon 降级路径不带 header。

### 自定义传输（request）

配置 `request: (logs) => ...` 会**完全替换**内置传输逻辑（不再走队列重试）。此模式下失去内置卸载兜底，请同时提供 `unloadRequest`，否则卸载时的批次会被跳过并计入 dropped 计数。

## 接入方责任

`extra` / `tags` / `custom` 类型数据由宿主自行构造，SDK **不递归清洗**这类字段，请勿在其中承载任何个人身份信息（邮箱、手机号、身份证号等 PII）。开启 `debug: true` 时，SDK 检测到上述字段疑似含 PII 会打印 warning。

## 已知边界

1. `performance.memory` 仅 Chromium 有效，数值经量化（约 100KB 粒度），只覆盖 JS 堆（不含 DOM / CSS / GPU / Worker）。
2. `sendBeacon` 降级路径无法携带自定义请求头，鉴权信息须在 body 或 URL 中（见上文）。
3. 跨域脚本错误需要业务方为 `<script>` 加 `crossorigin` 且 CDN 返回 `Access-Control-Allow-Origin`，否则退化为 `Script error.`。
4. 使用自定义 `request` 时失去内置卸载兜底，需自行实现 `unloadRequest`。
5. 本期不做会话回放、路径回溯、Source Map 反解、白屏检测。

## 本地开发

```bash
npm run ci          # lint + typecheck + test + build + size 全量校验
npm run test:watch  # 监听模式跑单测
npm run size        # 体积上限校验
```