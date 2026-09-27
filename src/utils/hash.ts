// 稳定指纹：32 位 FNV-1a 哈希，禁止使用 crypto API（性能与兼容性，见禁止事项 18）。

/**
 * 计算字符串的 32 位 FNV-1a 哈希，返回十进制数字字符串。
 * @param str 输入字符串
 */
export function fnv1a(str: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString()
}