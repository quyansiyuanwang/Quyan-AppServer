/** Presence marker only; never submit this display value as a replacement credential. */
export const SERVER_CONFIG_SECRET_PLACEHOLDER = '[configured]'
export function isSensitiveServerConfigKey(key: string): boolean {
  return /(password|secret|apiKey|token)$/i.test(key)
}
export function writableServerConfigs(
  configs: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(configs).filter(
      ([key, value]) =>
        !isSensitiveServerConfigKey(key) || value !== SERVER_CONFIG_SECRET_PLACEHOLDER,
    ),
  )
}
