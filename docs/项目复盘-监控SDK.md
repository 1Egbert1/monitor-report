# 项目复盘：一个前端监控 SDK 的十次返工

> 时间跨度：2026 年 9 月立项 ~ 10 月。范围：一个零依赖的浏览器端监控 SDK（错误 / 性能 / 网络 / 内存四维采集）。
> 这篇文章不复述功能清单，只写**我们做错的地方、怎么发现的、怎么改的**，以及最后沉淀下来的几条方法论。
> 每一节都对应一次真实的返工——有些是被数据打脸，有些是被自己的面试题问住。

---

## 目录 <a id="toc"></a>

> 全部可点击跳转。每章标题下方都有「↑ 返回目录」。

- [一、起点，以及一开始就埋下的坑](#rp-1)
- [二、成功率 99.8%，而线上正在炸](#rp-2)
  - [2.1 现象](#rp-2-1)
  - [2.2 定位](#rp-2-2)
  - [2.3 更难看的是同一个包里两个通道语义相反](#rp-2-3)
  - [2.4 修法](#rp-2-4)
  - [2.5 结果](#rp-2-5)
- [三、只有维度，没有严重度](#rp-3)
  - [3.1 问题](#rp-3-1)
  - [3.2 业界怎么做的](#rp-3-2)
  - [3.3 修法](#rp-3-3)
- [四、资源错误和代码错误：一个事件，两条通路](#rp-4)
  - [4.1 一个反直觉的细节](#rp-4-1)
  - [4.2 四处细节，全是坑](#rp-4-2)
- [五、一次结构性还债：一个能力散在 11 个文件](#rp-5)
  - [5.1 症状](#rp-5-1)
  - [5.2 把「结构有点乱」变成可量化判据](#rp-5-2)
  - [5.3 三步改造](#rp-5-3)
  - [5.4 结果](#rp-5-4)
- [六、切到后台三十秒，LCP 变成三十万毫秒](#rp-6)
  - [6.1 问题](#rp-6-1)
  - [6.2 当时其实已经挡住了一半](#rp-6-2)
  - [6.3 修法：对齐 web-vitals 的 `stopListening`](#rp-6-3)
  - [6.4 还没做的](#rp-6-4)
- [七、行为栈：让错误有上下文](#rp-7)
  - [7.1 为什么要做](#rp-7-1)
  - [7.2 一个广为流传的错误实现](#rp-7-2)
  - [7.3 三条隐私红线](#rp-7-3)
  - [7.4 快照必须在错误发生的那一刻取](#rp-7-4)
  - [7.5 路由：不猜模式，只记事实](#rp-7-5)
  - [7.6 console：只做上下文，不做日志管道](#rp-7-6)
  - [7.7 容量是被 payload 逼出来的](#rp-7-7)
- [八、React：没有全局钩子怎么办](#rp-8)
  - [8.1 两个设计问题](#rp-8-1)
- [九、工程化：那些「本地能过、CI 不过」的事](#rp-9)
  - [9.1 幽灵依赖](#rp-9-1)
  - [9.2 产物残缺](#rp-9-2)
- [十、回头看，五条能复用的方法论](#rp-10)
- [十一、还欠着的账（诚实清单）](#rp-11)
- [附：一句话版本](#rp-app)

---

## 一、起点，以及一开始就埋下的坑 <a id="rp-1"></a>

[↑ 返回目录](#toc)

最初的需求很朴素：把前端会出的错、会慢的地方采集起来，批量上报。四个维度各自一个模块，公共部分抽成 core：采样、过滤、补公共字段、脱敏、`beforeSend`、入队、调度、传输。

第一版跑通得很快，测试也写得挺全。问题在于——**测试测的是「我们以为的语义」，不是「浏览器的真实语义」**。下面几节几乎都是同一类错误的变体：代码本身没崩，逻辑自洽，但和它要描述的客观事实不是一回事。

---

## 二、成功率 99.8%，而线上正在炸 <a id="rp-2"></a>

[↑ 返回目录](#toc)

### 现象 <a id="rp-2-1"></a>

自建监控面板显示「接口成功率 99.8%」，同期客服反馈「下单按钮点了没反应」。抓包一看，`/api/order/submit` 返回 **500**。

### 定位 <a id="rp-2-2"></a>

网络模块的 XHR 包装里写着：

```ts
const resOk = aborted ? true : !meta.errored && !meta.timedOut
```

`errored` 只在 `error` 事件里被置为 true。

而 XHR 的 `error` 事件**只在传输层失败时触发**——DNS 解析失败、连接被拒、断网、被 CORS 拦。4xx/5xx 是「请求完整走完、服务端明确回了个错误响应」，它走的是 `load`，`errored` 依然是 `false`。

于是 404 和 500 全部被记成成功。

### 更难看的是同一个包里两个通道语义相反 <a id="rp-2-3"></a>

fetch 通道用的是 `res.ok`（`status` 在 200~299），4xx/5xx 天然是失败。也就是说：同一个后端错误，走 axios（底层 XHR）记成功，走 fetch 记失败。这种不一致比单纯的 bug 更危险——它让人对数据失去信任。

### 修法 <a id="rp-2-4"></a>

判据只留状态码，且**判定顺序**不能乱：

```
先看是否主动取消 → 再看超时 / 网络层错误 → 最后看状态码
```

顺序反了会把「用户切页导致的请求取消」记成失败（取消时 `status` 通常是 0），失败率被这些噪声抬起来。

顺带补掉两个认知：

- `status === 0` 至少有三种成因：CORS 被拦、`file://` 或 CSP 阻断、abort/timeout。不能一律记「网络错误」。
- 304 是缓存命中，不是错误，但 `res.ok === false`——它得单独判。

### 结果 <a id="rp-2-5"></a>

`NetworkData` 多了一个 `statusCategory`，把「失败」拆成十几个可区分语义的类别，配套一句带排查方向的文案。取值刻意对齐业界常见口径（success / redirect / bad_request / unauthorized / forbidden / not_found / client_error / server_error / timeout / aborted / network_error）。

这次返工教给我一件事：**监控 SDK 里最贵的 bug 不是崩溃，是「静默地记错」**。崩溃至少有人报错，记错会让整个数据体系失去意义，而且能瞒很久。

---

## 三、只有维度，没有严重度 <a id="rp-3"></a>

[↑ 返回目录](#toc)

### 问题 <a id="rp-3-1"></a>

同一张 `error` 表里，某个统计用的像素图片 404，和首屏的 `TypeError`，是并列关系、等权展示。想做「只对致命错误打电话告警」，只能在上报服务端按 `message` 写字符串规则。

当时以为 `type`（error/performance/network/memory）就是分级。不是。它是**采集维度**，维度之间不可比——performance 的 p99 恶化可能比 error 的图标 404 更严重。

### 业界怎么做的 <a id="rp-3-2"></a>

查了 Sentry 才发现它把这件事拆成两层：

| 层 | 内容 | 由谁计算 |
|---|---|---|
| 事件级 `level` | `fatal` / `error` / `warning` / `log` / `info` / `debug` | 采集侧，按来源确定性推导 |
| 问题级 priority | High / Medium / Low（首版就是按 level 映射，增强版再看 message、是否 handled、历史动作、频次激增） | **服务端**，聚合后计算 |

关键认知：**「这条日志多严重」和「这个故障多紧急」是两件事**。前者是数据契约，后者是聚合结论。

### 修法 <a id="rp-3-3"></a>

只做第一层，5 档（去掉 Sentry 的 `log`，它和 `info` 语义重叠），并且**不给业务方标注的负担**——全部由采集侧按事实推导：

| 来源 | 判定 | level |
|---|---|---|
| JS 错误 | chunk 加载失败 | `fatal` |
| JS / Promise / Vue / React 错误 | 其余 | `error` |
| 资源错误 | `<script>` 失败 | `error` |
| 资源错误 | 图片 / 样式 / 媒体 | `warning` |
| 接口 | 5xx、超时、网络层失败 | `error` |
| 接口 | 4xx、重定向 | `warning` |
| 接口 | 2xx、请求取消 | `info` |
| 性能指标 | 评级 poor | `warning` |
| 内存 | 高占用或疑似泄漏 | `warning` |

`fatal` 只留给一类：chunk 加载失败。因为它几乎必然导致页面不可用，和普通 `TypeError` 不是一个量级。

---

## 四、资源错误和代码错误：一个事件，两条通路 <a id="rp-4"></a>

[↑ 返回目录](#toc)

### 一个反直觉的细节 <a id="rp-4-1"></a>

`<img>` 加载失败和 `window.onerror` 用的是**同一个 `error` 事件**。区别在于：资源错误**不冒泡**。

所以分流不是靠「类型判断」，而是靠**监听阶段**：

```ts
window.addEventListener('error', onJsError)              // 冒泡阶段 → 代码错误
window.addEventListener('error', onResourceError, true)  // 捕获阶段 → 资源错误
```

捕获阶段先于冒泡执行，所以资源通道会先看到 window 级的 JS 错误——必须自己挡掉。

### 四处细节，全是坑 <a id="rp-4-2"></a>

**① 判元素不要用 `instanceof`。** 跨 realm（iframe、其他 document）时构造函数不同源，`instanceof Element` 会返回 false，事件被静默丢弃。用 `nodeType === 1`。

**② 必须有标签白名单。** 否则业务代码 `dispatchEvent(new Event('error'))`、或者自定义元素抛的 error，都会被记成「资源加载失败」。白名单是 img / script / link / video / audio / source / track / input。

**③ `iframe` 故意不列入。** 浏览器根本不会为 iframe 加载失败派发 error 事件，写进去只会让读代码的人误以为支持。

**④ `tagName` 和 `localName` 不是一回事。** HTML 文档里 `tagName` 是大写（`IMG`）；XML 文档里它保留原样、还可能带命名空间前缀（`svg:image`）；`localName` 去前缀但不保证小写。所以归一化写成 `(el.localName || el.tagName).toLowerCase()` 才稳。

顺带解决了「点击记错元素」的问题：取目标一律走 `composedPath()[0]`，因为 shadow DOM 会把 `event.target` retarget 成 host。

---

## 五、一次结构性还债：一个能力散在 11 个文件 <a id="rp-5"></a>

[↑ 返回目录](#toc)

### 症状 <a id="rp-5-1"></a>

想给「网络监控」加一个字段，需要改 11 个文件：类型定义、配置契约、默认值、配置合并、管道里的特化分支、核心主类的重放 switch、子路径注册表、全量装配表、根级入口、构建入口、`package.json` 的 exports。

更糟的是 `core/pipeline.ts` 里那些 `if (type === 'network')`——新增模块时忘了加，黑名单过滤就**静默失效**。

### 把「结构有点乱」变成可量化判据 <a id="rp-5-2"></a>

抱怨「目录松散」是没法推进的。换成两个问题就能推进：

1. 新增一个同类能力，要改几个地方？
2. 漏改其中一处，会不会报错？

第二问比第一问重要。前者是效率问题，后者是**正确性**问题。

### 三步改造 <a id="rp-5-3"></a>

**第一步：把重复的声明收敛成一张表。** 类型层用映射表替代手工联合：

```ts
export interface LogDataMap {
  error: ErrorData
  performance: PerformanceData
  network: NetworkData
  memory: MemoryData
  custom: Record<string, unknown>
}
export type LogType = keyof LogDataMap
export type LogDataOf<T extends LogType> = LogDataMap[T]
export type ReportLog = { [K in LogType]: LogBase & { type: K; data: LogDataMap[K] } }[LogType]
```

原来 5 处手工同步（`LogType`、五个 `XxxLog`、`ReportLog`、`LogDataOf`）全部自动派生。收益不是「少写几行」，是**漏改变成编译错误**。

**第二步：让能力自我描述，核心只认接口。**

```ts
export const networkModule = defineModule({
  type: 'network',
  create: createNetworkMonitor,
  filter: (data, config) => matchesBlacklist(data.reqUrl, config.urlBlacklist),
  startTimeOf: (data) => data.reqStartTime,
  levelOf: levelOfNetwork
})
```

于是 `core/` 里再没有出现任何具体模块名——特化通过钩子注入，而不是靠 `if` 判断。

**第三步：入口只有一处事实源。** 构建入口（`tsup`）与包导出（`package.json#exports`）原本各写一份，改成从同一份清单派生，并在 CI 里加一致性校验。否则「改了构建忘了改 exports」这类漂移，只会在用户安装时暴露。

### 结果 <a id="rp-5-4"></a>

新增一个采集维度：**11 处 → 4 处声明**，且漏改必然编译报错。

但有个约束必须同时守住：**子路径入口不得 import 全量清单**，否则 `monitor-report/error` 会把网络、性能、内存全打进去，按需引入形同虚设。这不是风格问题，是产物正确性问题——所以我们用 `dist/error.js` 里不含 `NetworkMonitor` / `XMLHttpRequest` 作为断言。

---

## 六、切到后台三十秒，LCP 变成三十万毫秒 <a id="rp-6"></a>

[↑ 返回目录](#toc)

### 问题 <a id="rp-6-1"></a>

有人问：用户在 LCP 测量期间切到别的标签页、过一会儿回来，会不会产生几十万毫秒的 LCP？

会。

LCP 候选的 `startTime` 是**距 `timeOrigin` 的毫秒数**。后台停留的时间天然被算进去。如果 SDK 此时还在监听，取最大值就会上报一个离谱的数，把分位数打爆。

### 当时其实已经挡住了一半 <a id="rp-6-2"></a>

`visibilitychange` 切到 hidden 时，模块会立即结算并断开全部 Observer——所以「切走 → 回来 → 浏览器重新 paint」这条路是死的。

漏的是两段：

1. **首次交互之后、页面隐藏之前**：规范说首次输入后不该再有新候选，但我们只依赖浏览器自觉，没有自己停。
2. **SDK 晚初始化**：`buffered: true` 会把后台期间的候选补发过来，而初始化时页面已经是 visible，不会触发结算。

### 修法：对齐 web-vitals 的 `stopListening` <a id="rp-6-3"></a>

`keydown` / `click`（capture + once）一旦触发就冻结 LCP：

- 置 `lcpFrozen`，此后所有候选一律拒绝
- **只断开 LCP 的 Observer**，CLS / INP 必须继续观察（一把全断开是常见 bug）
- 移掉交互监听

顺手修了一个语义漏洞：`reportPerformanceOnHiddenOnly` 这个配置原来只对 FCP 生效，而且 `false` 时 FCP 会被上报两次（采集时一次、隐藏结算又一次）。现在 FCP / LCP 都用 `reported` 标记保证只报一次；CLS / INP 属累积型指标，两种配置下都以页面生命周期为界结算——这点写进文档，免得有人以为 `false` 等于「全部实时」。

### 还没做的 <a id="rp-6-4"></a>

给指标加 `outlier` 标记和 `hiddenDurationMs` 字段。我倾向「标记但不丢弃」：静默丢掉，你就永远不知道有多少人卡在后台。

---

## 七、行为栈：让错误有上下文 <a id="rp-7"></a>

[↑ 返回目录](#toc)

### 为什么要做 <a id="rp-7-1"></a>

排查线上错误时只有堆栈，不知道用户点了什么、从哪个页面来的。业界的解法是行为栈（breadcrumb）：环形缓冲记录用户操作，**错误发生时把快照附在错误上**，而不是自己独立上报。

### 一个广为流传的错误实现 <a id="rp-7-2"></a>

参考实现里常见这样写：

```js
on(document, 'click', function () {
  const html = htmlElementAsString(document.activeElement)  // ← 这里
  breadcrumb.push({ type: 'click', data: html })
})
```

`document.activeElement` 是**当前聚焦元素**，不是被点击的元素。点一个不可聚焦的 `<div>`，它大概率是 `body`。行为栈里堆满 `body`，等于没记。

正确做法是 `composedPath()[0]`，回退 `event.target`。顺手解决 shadow DOM 的 retarget。

### 三条隐私红线 <a id="rp-7-3"></a>

**① 表单控件连 `textContent` 都不能取。** `<textarea>用户填的备注</textarea>` 的 `textContent` 就是内容本身；`<select>` 的 `textContent` 是全部选项文案。只记 `type`（`password` / `tel`）。

**② `href` 去掉 query。** 链接里经常带 token。

**③ 永不读取 `input.value`。**

文本统一截断 30 字并过 PII 兜底（邮箱 / 手机号 / 身份证）。

### 快照必须在错误发生的那一刻取 <a id="rp-7-4"></a>

```ts
// aggregate() 里取快照 —— 错误首次出现
const snapshot = this.breadcrumbs?.snapshot() ?? []
```

而不是在 `emitEntry()` 里取。因为上报要等去重窗口（默认 5 秒）扫到才执行，那时用户早做了别的操作，快照会失真。

这条有测试守着：错误之后再点击别的元素，不得污染已生成的那条日志。

### 路由：不猜模式，只记事实 <a id="rp-7-5"></a>

一个常见的需求是「兼容 history 和 hash 两种路由」。直觉做法是先判断模式，其实是错的：

- 模式是路由库的概念，SDK 猜不准——history 应用也可能用 hash 做锚点，hash 路由库内部也常调 `pushState`
- 猜错的代价是整个通道漏采

所以四个来源全接：wrap `pushState` / `replaceState`，监听 `popstate` / `hashchange`，把**触发方式**记成 `kind`，归类交给报表端。

三个必须处理的细节：

- `from === to` 不记录（路由库常用 `replaceState` 同步 query，会产生大量噪声）
- wrap 要保留原生引用、保持 `this`，`destroy` 时**必须还原**，否则会和 React Router / Vue Router / 微前端互相覆盖
- 已知副作用：`history.pushState.toString()` 会变成包装后的源码，靠它判断原生性的库会受影响

### console：只做上下文，不做日志管道 <a id="rp-7-6"></a>

业务里有大量「被 catch 后只打日志」的错误：

```js
try { await submit() } catch (e) { console.error('提交失败', e); toast('提交失败') }
```

这类错误 `window.onerror` 完全看不到，是最容易漏的一类。所以 console 值得接——但只作为行为栈，默认只截 `warn` / `error` / `assert`。

参数**不能直接 `JSON.stringify`**：循环引用会抛错、DOM 节点变成 `{}`、大对象撑爆 payload。于是写了安全序列化：循环 → `[Circular]`、Error 只取 name + message、函数和 DOM 用占位符、深度 ≤ 2、键 ≤ 5、单串 ≤ 80。

### 容量是被 payload 逼出来的 <a id="rp-7-7"></a>

`maxBreadcrumbs` 默认 20，比 Sentry 的 100 小——因为要照顾 `sendBeacon` / keepalive 的 60KB 上限。20 条带结构化 data 的快照大约 2~3KB，留足余量。

---

## 八、React：没有全局钩子怎么办 <a id="rp-8"></a>

[↑ 返回目录](#toc)

Vue 好办，`config.errorHandler` 挂上去就行。React 没有对应物，官方机制是 **Error Boundary**——一个实现了 `componentDidCatch` 的类组件。

### 两个设计问题 <a id="rp-8-1"></a>

**① 插件是工厂，不是常量。** boundary 必须 `extends React.Component`，所以 `React` 得在运行时拿到。我们沿用 Vue 插件的约定：**SDK 不 import 任何框架**，由宿主注入：

```ts
const Boundary = createErrorBoundary(React, monitor)
<Boundary fallback={<ErrorPage />}>{children}</Boundary>
```

副作用挺好：`fallback` 由宿主用 JSX 建好传入，SDK 完全不用调 `createElement`，所以插件文件是纯 `.ts`。测试也不需要装 react——用假 `React.Component` 就能跑完整逻辑。

**② 必须说清覆盖边界。** boundary 只捕获渲染、构造函数、生命周期里的错误；事件处理器里的错误不进 boundary，仍走 `window.onerror`；异步错误走 `unhandledrejection`。

所以结论不是「加了 boundary 就全覆盖」，而是**两条路都要接**：boundary 拿组件栈，全局通道兜异步和事件，互补不重叠。

顺带把 `errorInfo.componentStack` 单独存了一个字段（裁剪到 10 层），而不是塞进 `stack`——组件栈和 JS 堆栈是两份不同的信息，混在一起服务端就没法按组件名聚合了。

---

## 九、工程化：那些「本地能过、CI 不过」的事 <a id="rp-9"></a>

[↑ 返回目录](#toc)

### 幽灵依赖 <a id="rp-9-1"></a>

第一次发版，CI 在 typecheck 阶段就挂了：

```
error TS2307: Cannot find module 'node:child_process'
error TS2580: Cannot find name 'process'
```

本地一切正常。原因是项目**从来没声明过 `@types/node`**，它只是 vitest / tsup 的传递依赖，被 npm 提升到了顶层 `node_modules`，TypeScript 又默认自动加载 `node_modules/@types` 下的全部包——于是「碰巧」能解析。

`npm ci` 按 lockfile 重铺依赖树，布局不一定相同；换成 pnpm（默认不提升）本地立刻复现。

本质是**幽灵依赖**。修法就一行：写进 `devDependencies`。不能用 `skipLibCheck` 糊——它管的是声明文件内部的检查，救不了「模块解析失败」。

### 产物残缺 <a id="rp-9-2"></a>

有一次 `dist` 只剩 37 个文件，`index.js` 都不见了，但构建「成功」，退出码 0。

根因不是构建器有 bug，是**两个测试文件各自并行执行了一次构建，写同一个输出目录**。构建器默认 `clean: true` 先删后写，两个进程互相删改，最后落盘的是两者交错的残骸。

两处修：

- 测试侧：加文件锁串行化构建，并把「产物完整性检查」也放进锁里
- 流水线侧：加三层校验——`exports` 里的每个目标文件存在、产物内相对引用可解析（chunk 不断链）、文件数量符合预期

关键心态是：**构建成功 ≠ 产物完整**。退出码只能说明构建器没崩，不能说明产出可用。

而且校验脚本本身要有负向测试——手动删掉一个 chunk，它必须报错退出。一个永远不会失败的校验，等于没有校验。

---

## 十、回头看，五条能复用的方法论 <a id="rp-10"></a>

[↑ 返回目录](#toc)

**1. 新东西先对齐业界，再动手。**
级别取 5 档还是 6 档、状态码怎么分类、行为栈放哪些字段——这些都有事实标准（Sentry 的 event level / issue priority、OpenTelemetry、Web Vitals）。自造一套的成本不在写的时候，在于以后每次对接都要翻译一次。

**2. 把约束变成编译错误，而不是靠自觉。**
「新增维度要记得改这 5 处」这种约定必然失守。改成一张映射表 + 派生的联合类型，漏改就是编译失败。前者是文档，后者是机制。

**3. 用可量化判据代替主观判断。**
「结构有点乱」没法讨论，「新增要改 11 个文件、漏改不报错」可以讨论，也能验收。

**4. 校验必须有负向测试。**
完整性校验、类型约束、CI 闸门——凡是「防止出错」的东西，都要验证它**真的会失败**。删掉一个 chunk 看它报不报错，比看它通过有价值得多。

**5. 分清「我验证过的事实」和「我的推断」。**
这条是写给自己的。过程中我曾经用 `grep | head -6` 查一个配置项的使用点，输出被截断，于是断言「这是个死配置」。实际上它在第 7 行被读取了——我基于错误的观察给了一个错误结论，而对方已经据此做了决定。

后来补了纠正。教训是：**下结论前先确认证据的完整性**，尤其是「某处没有被使用」这种否定性命题，截断的输出是最容易骗人的。

---

## 十一、还欠着的账（诚实清单） <a id="rp-11"></a>

[↑ 返回目录](#toc)

- **LCP / FCP 的离群值标记**：只做了冻结，没做 `outlier: true` 和 `hiddenDurationMs`，服务端目前只能靠分位数自己兜。
- **资源错误拿不到 HTTP 状态码**：浏览器在 `<img>` / `<script>` 失败时只给一个 error 事件，没有 status。要拿得靠 `PerformanceObserver` 的 resource 条目，且跨域时缺 `Timing-Allow-Origin` 仍然拿不全。
- **React 只覆盖 boundary**：事件与异步错误依赖全局通道，这是 React 的设计限制，不是实现缺陷，但文档必须反复强调。
- **体积接近上限**：core + error 已经 7.8 kB，单模块预算刚从 8 kB 提到 10 kB。再加一类行为栈就得重新审视预算或做压缩。
- **没有 sourcemap 还原**：`dist` 带 `.map`，但堆栈还原需要上报服务端做，SDK 侧不做。

---

## 附：一句话版本 <a id="rp-app"></a>

[↑ 返回目录](#toc)

如果一个监控 SDK 只能记住一件事，那就是——**它最贵的 bug 不是崩溃，是静默地记错**。成功率 99.8% 而线上在炸，这个反差比任何一次线上故障都更值得记住。
