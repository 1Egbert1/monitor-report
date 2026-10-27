// 编译期穷尽检查（exhaustive check）。
/**
 * 断言联合类型的所有成员都已被处理。
 * 放在 switch 的 default 分支里：新增成员而漏加分支时，此处会变成编译错误，
 * 而不是运行时静默丢弃。
 * @param value 理论上不可能到达的值
 */
export function assertNever(value: never): never {
  throw new Error(`[monitor-report] 未处理的类型分支: ${String(value)}`)
}
