// 元素选择器生成（脱敏）：只输出 父标签 > 标签:nth-child(n)，最多 4 层，不含 id/class/data-*。
export { nodeSelector as generateSelector } from '../../utils/mask'