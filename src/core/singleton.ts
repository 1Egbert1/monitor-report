// 重复注入保护（规格书 6.7）：window.__MONITOR_REPORT__ 存 { version, instance }。
import { sdkVersion } from '../constants/version'

/** 单例槽位中的实例最小接口（避免对 LogReport 的循环类型依赖）。 */
export interface SingletonInstance {
  destroy(opts?: { flush?: boolean }): void
}

/** 全局单例槽位结构。 */
export interface SingletonSlot {
  version: string
  instance: SingletonInstance
}

declare global {
  interface Window {
    __MONITOR_REPORT__?: SingletonSlot
  }
}

/**
 * 读取全局槽位并创建/复用实例：
 * - 无槽位：创建新实例并登记；
 * - 版本相同：warning 后复用已有实例；
 * - 版本不同：warning 后 destroy 旧实例，创建新实例。
 * @param create 实例工厂
 */
export function createSingleton<T extends SingletonInstance>(create: () => T): T {
  const existing = readSlot()
  if (existing) {
    if (existing.version === sdkVersion) {
      console.warn(
        '[monitor-report] duplicate injection detected (same version), reusing existing instance'
      )
      return existing.instance as T
    }
    console.warn(
      `[monitor-report] version mismatch (${existing.version} -> ${sdkVersion}), destroying old instance`
    )
    existing.instance.destroy({ flush: true })
  }
  const instance = create()
  if (typeof window !== 'undefined') {
    window.__MONITOR_REPORT__ = { version: sdkVersion, instance }
  }
  return instance
}

/**
 * destroy 时从全局槽位移除自身。
 * @param instance 本实例
 */
export function unregisterSingleton(instance: SingletonInstance): void {
  if (typeof window !== 'undefined' && window.__MONITOR_REPORT__?.instance === instance) {
    delete window.__MONITOR_REPORT__
  }
}

/**
 * 读取全局槽位（非浏览器环境返回 undefined）。
 */
function readSlot(): SingletonSlot | undefined {
  return typeof window !== 'undefined' ? window.__MONITOR_REPORT__ : undefined
}