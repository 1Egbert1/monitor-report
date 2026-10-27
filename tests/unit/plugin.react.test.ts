// React 插件测试（规格书 7.5）：ErrorBoundary 上报、fallback 渲染、宿主回调与异常隔离。
// 故意不安装 react —— 插件接受宿主传入的 React 命名空间，因此可用假实现完整测试。
import { describe, expect, it, vi } from 'vitest'
import {
  captureReactError,
  createErrorBoundary,
  toReactErrorData,
  truncateComponentStack,
  type ReactLike
} from '../../src/plugins/react'
import type { ErrorData } from '../../src/contracts/log'
import type { LogReport } from '../../src/core/LogReport'

/** 最小的 React 替身：只要能 new 出带 props / state 的实例即可。 */
function makeReact(): ReactLike {
  class Component {
    props: Record<string, unknown>
    state: Record<string, unknown> = {}
    constructor(props: Record<string, unknown>) {
      this.props = props
    }
  }
  return { Component }
}

/** 假的 monitor，只记录 addReport 调用。 */
function makeMonitor(throwOnReport = false) {
  const calls: ErrorData[] = []
  const monitor = {
    addReport: (_type: string, data: ErrorData) => {
      if (throwOnReport) throw new Error('report failed')
      calls.push(data)
    }
  } as unknown as LogReport
  return { monitor, calls }
}

describe('toReactErrorData', () => {
  it('归一化为 react_error，保留消息与堆栈', () => {
    const data = toReactErrorData(new TypeError('boom'), { componentStack: '\n  in Foo\n  in App' })
    expect(data.errorType).toBe('react_error')
    expect(data.message).toBe('boom')
    expect(data.stack).toContain('boom')
    expect(data.componentStack).toContain('in Foo')
    expect(data.count).toBe(1)
  })

  it('非 Error 的抛出值也能兜住', () => {
    expect(toReactErrorData('字符串错误').message).toBe('字符串错误')
    expect(toReactErrorData({ code: 1 }).message).toBe('React Error')
  })

  it('组件栈裁剪到 10 层', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `  in C${i}`).join('\n')
    expect(truncateComponentStack(lines)?.split('\n').length).toBe(10)
  })

  it('空组件栈不写入字段', () => {
    expect(toReactErrorData(new Error('x')).componentStack).toBeUndefined()
    expect(truncateComponentStack('   ')).toBeUndefined()
  })
})

describe('createErrorBoundary', () => {
  const React = makeReact()

  it('getDerivedStateFromError 标记 hasError', () => {
    const { monitor } = makeMonitor()
    const Boundary = createErrorBoundary(React, monitor)
    expect((Boundary as unknown as { getDerivedStateFromError(): unknown })
      .getDerivedStateFromError()).toEqual({ hasError: true })
  })

  it('componentDidCatch 上报 react_error 并带组件栈', () => {
    const { monitor, calls } = makeMonitor()
    const Boundary = createErrorBoundary(React, monitor)
    const instance = new Boundary({ children: 'x' }) as unknown as {
      componentDidCatch(error: Error, info: { componentStack: string }): void
    }
    instance.componentDidCatch(new Error('渲染失败'), { componentStack: '\n  in Detail\n  in App' })

    expect(calls.length).toBe(1)
    expect(calls[0]?.errorType).toBe('react_error')
    expect(calls[0]?.message).toBe('渲染失败')
    expect(calls[0]?.componentStack).toContain('in Detail')
  })

  it('未出错时渲染 children，出错时渲染 fallback', () => {
    const { monitor } = makeMonitor()
    const Boundary = createErrorBoundary(React, monitor)
    const ok = new Boundary({ children: 'child', fallback: 'fallback' })
    expect(ok.render()).toBe('child')

    const bad = new Boundary({ children: 'child', fallback: 'fallback' })
    bad.state = { hasError: true }
    expect(bad.render()).toBe('fallback')
  })

  it('没有 fallback 时渲染 null', () => {
    const { monitor } = makeMonitor()
    const Boundary = createErrorBoundary(React, monitor)
    const instance = new Boundary({ children: 'child' })
    instance.state = { hasError: true }
    expect(instance.render()).toBeNull()
  })

  it('宿主 onError 被调用，且拿到同一个 error', () => {
    const { monitor } = makeMonitor()
    const onError = vi.fn()
    const Boundary = createErrorBoundary(React, monitor)
    const err = new Error('x')
    new Boundary({ children: 'c', onError }).componentDidCatch(err, { componentStack: '' })
    expect(onError).toHaveBeenCalledWith(err, { componentStack: '' })
  })

  it('宿主 onError 抛错不冒泡', () => {
    const { monitor } = makeMonitor()
    const Boundary = createErrorBoundary(React, monitor)
    const instance = new Boundary({
      children: 'c',
      onError: () => {
        throw new Error('host failed')
      }
    })
    expect(() => instance.componentDidCatch(new Error('x'), { componentStack: '' })).not.toThrow()
  })

  it('monitor 上报抛错不冒泡', () => {
    const { monitor } = makeMonitor(true)
    const Boundary = createErrorBoundary(React, monitor)
    const instance = new Boundary({ children: 'c' })
    expect(() => instance.componentDidCatch(new Error('x'), { componentStack: '' })).not.toThrow()
  })
})

describe('captureReactError', () => {
  it('手动上报一次 react_error', () => {
    const { monitor, calls } = makeMonitor()
    captureReactError(monitor, new Error('手动'), { componentStack: '\n  in Foo' })
    expect(calls.length).toBe(1)
    expect(calls[0]?.errorType).toBe('react_error')
  })
})
