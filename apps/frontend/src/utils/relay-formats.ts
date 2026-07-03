export const SUPPORTED_RELAY_FORMATS = ['openai', 'anthropic', 'gemini'] as const

export type RelayFormat = (typeof SUPPORTED_RELAY_FORMATS)[number]

const relayFormatSet = new Set<RelayFormat>(SUPPORTED_RELAY_FORMATS)

const normalizeRelayFormat = (value: string): RelayFormat | null => {
  const normalized = value.trim().toLowerCase()
  if (!relayFormatSet.has(normalized as RelayFormat)) return null
  return normalized as RelayFormat
}

const dedupeRelayFormats = (formats: RelayFormat[]): RelayFormat[] => Array.from(new Set(formats))

export const parseConfiguredRelayFormats = (formats?: string | null): RelayFormat[] => {
  if (!formats?.trim()) return []
  if (formats.trim().toLowerCase() === 'all') return []

  const parsed = formats
    .split(',')
    .map((format) => normalizeRelayFormat(format))
    .filter((format): format is RelayFormat => Boolean(format))

  return dedupeRelayFormats(parsed)
}

export const normalizeRelayFormats = (formats?: string | null): RelayFormat[] => {
  const configured = parseConfiguredRelayFormats(formats)
  return configured.length > 0 ? configured : [...SUPPORTED_RELAY_FORMATS]
}

export const normalizeRelayFormatArray = (formats?: string[] | null): RelayFormat[] => {
  if (!formats?.length) return []

  const normalized = formats
    .map((format) => normalizeRelayFormat(String(format)))
    .filter((format): format is RelayFormat => Boolean(format))

  return dedupeRelayFormats(normalized)
}

export const toConfiguredRelayFormats = (formats?: string[] | string | null): RelayFormat[] => {
  if (Array.isArray(formats)) return normalizeRelayFormatArray(formats)
  return parseConfiguredRelayFormats(formats)
}

export const serializeRelayFormats = (formats?: string[] | string | null): string => {
  const configured = toConfiguredRelayFormats(formats)
  return configured.length > 0 ? configured.join(',') : 'all'
}
