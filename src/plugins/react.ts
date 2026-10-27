// React 适配插件：用 ErrorBoundary 捕获组件树内的渲染/生命周期错误。
//
// 为什么不 import react：SDK 保持零框架依赖（与 vue2/vue3 插件同一约定），
// 由宿主把 React 命名空间传进来。因此本文件的测试也不需要安装 react。
//
// 覆盖范围（React 官方限制，文档必须写明）：
// - ✅ 渲染、构造函数、生命周期方法中的错误
// - ❌ 事件处理器（handler 里抛的错不会进 boundary，仍走 window.onerror）
// - ❌ 异步代码（setTimeout / Promise 回调）
// - ❌ 服务端渲染
import type { ErrorData } from '../contracts/log'
import type { LogReport } from '../core/LogReport'

/** 组件栈裁剪层数（与堆栈的 10 帧保持一致）。 */
const COMPONENT_STACK_MAX = 10

/** React 组件实例的最小结构。 */
export interface ReactComponentInstance {
  props: Record<string, unknown>
  state: Record<string, unknown>
}

/** React 命名空间的最小结构（不引入 react 依赖）。 */
export interface ReactLike {
  Component: new (props: Record<string, unknown>) => ReactComponentInstance
}

/** `errorInfo` 的最小结构。 */
export interface ReactErrorInfo {
  componentStack?: string
}

/** ErrorBoundary 的 props（用 type 而非 interface，便于与框架类型互操作）。 */
export type ReactErrorBoundaryProps = {
  children?: unknown
  /** 出错时渲染的内容，由宿主用 JSX 创建好传入（SDK 不调 createElement） */
  fallback?: unknown
  /** 宿主自己的错误回调，SDK 上报完成后调用，异常不影响上报 */
  onError?: (error: Error, info: ReactErrorInfo) => void
}

/**
 * 把 React 错误归一化为 ErrorData。
 * @param error 错误对象（React 传入的通常是 Error 实例）
 * @param info 含 componentStack 的附加信息
 */
export function toReactErrorData(error: unknown, info?: ReactErrorInfo): ErrorData {
  const e = error instanceof Error ? error : null
  const now = Date.now()
  const data: ErrorData = {
    errorType: 'react_error',
    message: e ? e.message || e.name : typeof error === 'string' ? error : 'React Error',
    stack: e ? e.stack : undefined,
    count: 1,
    firstSeen: now,
    lastSeen: now
  }
  const componentStack = truncateComponentStack(info?.componentStack)
  if (componentStack) {
    data.componentStack = componentStack
  }
  return data
}

/**
 * 裁剪组件栈：只保留前 N 层，避免长组件树撑大 payload。
 * @param componentStack 原始组件栈
 */
export function truncateComponentStack(componentStack?: string): string | undefined {
  if (!componentStack) return undefined
  const lines = componentStack.split('\n').filter((line) => line.trim() !== '')
  if (lines.length === 0) return undefined
  return lines.slice(0, COMPONENT_STACK_MAX).join('\n')
}

/**
 * 手动上报一次 React 错误（宿主自己实现 boundary 或接了 errorHandler 时用）。
 * @param monitor 监控实例
 * @param error 错误对象
 * @param info 含 componentStack 的附加信息
 */
export function captureReactError(
  monitor: LogReport,
  error: unknown,
  info?: ReactErrorInfo
): void {
  monitor.addReport('error', toReactErrorData(error, info))
}

/** ErrorBoundary 实例的可见成员（便于宿主在测试或自定义逻辑中调用）。 */
export interface ReactErrorBoundaryInstance {
  props: ReactErrorBoundaryProps
  state: { hasError: boolean }
  componentDidCatch(error: Error, info: ReactErrorInfo): void
  render(): unknown
}

/**
 * 构造一个 ErrorBoundary 组件类。
 * 用法：`const Boundary = createErrorBoundary(React, monitor)`，然后当作普通组件用。
 * @param React 宿主的 React 命名空间（只需 `Component`）
 * @param monitor 监控实例
 */
export function createErrorBoundary(
  React: ReactLike,
  monitor: LogReport
): new (props: ReactErrorBoundaryProps) => ReactErrorBoundaryInstance {
  return class MonitorErrorBoundary extends React.Component {
    override state = { hasError: false }

    /**
     * React 16+ 的静态钩子：在渲染阶段标记出错，避免继续渲染坏掉的子树。
     */
    static getDerivedStateFromError(): { hasError: boolean } {
      return { hasError: true }
    }

    /**
     * 提交阶段回调：上报 + 透传宿主回调。
     * @param error 错误对象
     * @param info 含 componentStack
     */
    componentDidCatch(error: Error, info: ReactErrorInfo): void {
      const props = this.props as unknown as ReactErrorBoundaryProps
      try {
        monitor.addReport('error', toReactErrorData(error, info))
      } catch {
        // 上报异常不得影响 React 的渲染流程
      }
      if (typeof props.onError === 'function') {
        try {
          props.onError(error, info)
        } catch {
          // 宿主回调异常同样不得冒泡
        }
      }
    }

    /**
     * 渲染：出错时渲染宿主提供的 fallback（未提供则渲染空）。
     */
    render(): unknown {
      const props = this.props as unknown as ReactErrorBoundaryProps
      if (this.state.hasError) {
        return props.fallback ?? null
      }
      return props.children ?? null
    }
  } as unknown as new (props: ReactErrorBoundaryProps) => ReactErrorBoundaryInstance
}
