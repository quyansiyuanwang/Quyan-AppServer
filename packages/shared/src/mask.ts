/**
 * 敏感值展示的统一脱敏契约。
 *
 * backend 与 frontend 共用同一份实现，避免各处自行拼装 `前缀...后缀` 造成
 * 分隔符、长度与过短值兜底不一致。Rust CLI 无法引用本模块，
 * `apps/cli-native/src/core/credentials.rs` 的 `mask` 保持独立实现，
 * 语义对应关系为「过短值输出固定占位符，否则输出前缀 + `...` + 后缀」。
 */

export interface MaskOptions {
  /** 显式指定前缀可见长度，省略时按长度自适应 */
  prefixLength?: number
  /** 显式指定后缀可见长度，省略时按长度自适应 */
  suffixLength?: number
  /** 前后缀之间的分隔符，默认 `...` */
  separator?: string
  /** 长度不足以安全遮罩时输出的占位符，默认 `********` */
  placeholder?: string
  /** 自适应时每侧可见字符占原串长度的比例，默认 0.2 */
  visibleRatio?: number
  /** 自适应时每侧最少可见字符数，默认 4 */
  minVisible?: number
  /** 自适应时每侧最多可见字符数，默认 8 */
  maxVisible?: number
  /** 遮罩后至少需要隐藏的字符数，默认 4 */
  minHidden?: number
}

const DEFAULT_SEPARATOR = '...'
const DEFAULT_PLACEHOLDER = '********'
const DEFAULT_VISIBLE_RATIO = 0.2
const DEFAULT_MIN_VISIBLE = 4
const DEFAULT_MAX_VISIBLE = 8
const DEFAULT_MIN_HIDDEN = 4

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

const toNonNegativeInteger = (value: number | undefined, fallback: number) =>
  Number.isFinite(value) && (value as number) >= 0 ? Math.floor(value as number) : fallback

/**
 * 按字符串长度自适应每侧可见字符数。
 */
const resolveAdaptiveVisible = (length: number, options: MaskOptions): number => {
  const ratio = Number.isFinite(options.visibleRatio)
    ? Math.max(options.visibleRatio as number, 0)
    : DEFAULT_VISIBLE_RATIO
  const minVisible = toNonNegativeInteger(options.minVisible, DEFAULT_MIN_VISIBLE)
  const maxVisible = Math.max(
    toNonNegativeInteger(options.maxVisible, DEFAULT_MAX_VISIBLE),
    minVisible,
  )
  return clamp(Math.round(length * ratio), minVisible, maxVisible)
}

/**
 * 敏感值展示：统一为 `前缀 + 分隔符 + 后缀`，长度不足时返回占位符。
 */
export function maskSecret(value: unknown, options: MaskOptions = {}): string {
  const normalized = value === null || value === undefined ? '' : String(value)
  const separator = options.separator ?? DEFAULT_SEPARATOR
  const placeholder = options.placeholder ?? DEFAULT_PLACEHOLDER
  if (!normalized) return placeholder

  const adaptiveVisible = resolveAdaptiveVisible(normalized.length, options)
  const prefixLength = toNonNegativeInteger(options.prefixLength, adaptiveVisible)
  const suffixLength = toNonNegativeInteger(options.suffixLength, adaptiveVisible)
  const minHidden = toNonNegativeInteger(options.minHidden, DEFAULT_MIN_HIDDEN)

  if (normalized.length < prefixLength + suffixLength + separator.length + minHidden) {
    return placeholder
  }

  return `${normalized.slice(0, prefixLength)}${separator}${normalized.slice(-suffixLength)}`
}

/**
 * 非敏感长文本截断：长度不超过 `maxLength` 时原样返回，否则保留首尾并插入 `...`。
 */
export function truncateMiddle(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  const half = Math.floor((maxLength - 3) / 2)
  return `${value.slice(0, half)}...${value.slice(value.length - half)}`
}

/**
 * 邮箱脱敏：保留域名与名字前两位，名字过短时至少保留一个字符。
 */
export function maskEmail(email: unknown): string {
  const normalized = email === null || email === undefined ? '' : String(email)
  const [name, domain] = normalized.split('@')
  if (!name || !domain) return normalized
  if (name.length <= 2) return `${name[0] || '*'}*@${domain}`

  const maskedName = `${name.slice(0, 2)}${'*'.repeat(Math.max(2, name.length - 2))}`
  return `${maskedName}@${domain}`
}
