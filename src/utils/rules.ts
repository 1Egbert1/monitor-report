// 过滤规则（规格书 6.3 第 3 步）：由各模块声明自己的匹配逻辑，核心管道不再内联。

/**
 * ignoreErrors 命中判定：string 子串匹配，RegExp 匹配（使用前重置 lastIndex，避免 g/y 标志的粘滞状态）。
 * @param message 错误消息
 * @param rules 忽略规则
 */
export function matchesIgnore(message: string, rules: readonly (string | RegExp)[]): boolean {
  return rules.some((rule) => {
    if (typeof rule === 'string') return message.includes(rule)
    rule.lastIndex = 0
    return rule.test(message)
  })
}

/**
 * urlBlacklist 命中判定（子串匹配）。
 * @param url 请求地址
 * @param blacklist 黑名单
 */
export function matchesBlacklist(url: string, blacklist: readonly string[]): boolean {
  return blacklist.some((item) => url.includes(item))
}
