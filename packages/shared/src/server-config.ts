/** Presence marker only; never submit this display value as a replacement credential. */
export const SERVER_CONFIG_SECRET_PLACEHOLDER = '[configured]'
export function isSensitiveServerConfigKey(key: string): boolean {
  return /(password|secret|apiKey|token)$/i.test(key)
}
export function isSensitiveServerConfigValue(key: string, value: string): boolean {
  if (isSensitiveServerConfigKey(key)) return true
  try {
    const url = new globalThis.URL(value)
    return Boolean(url.username || url.password)
  } catch {
    return false
  }
}
export function writableServerConfigs(
  configs: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(configs).filter(([, value]) => value !== SERVER_CONFIG_SECRET_PLACEHOLDER),
  )
}
