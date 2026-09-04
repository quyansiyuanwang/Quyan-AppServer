import {
  ALL_RELAY_REQUEST_FORMATS,
  RELAY_REQUEST_FORMATS,
  type RelayConfiguredRequestFormat,
} from '@quyan/shared'

export type RelayFormat = RelayConfiguredRequestFormat

const relayFormatSet = new Set<RelayFormat>(RELAY_REQUEST_FORMATS)

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
    .map((format) =>
      format.trim().toLowerCase() === 'openai' ? 'openai-chat-completions' : format,
    )
    .map((format) => normalizeRelayFormat(format))
    .filter((format): format is RelayFormat => Boolean(format))

  return dedupeRelayFormats(parsed)
}

export const normalizeRelayFormats = (formats?: string | null): RelayFormat[] => {
  const configured = parseConfiguredRelayFormats(formats)
  if (configured.length > 0) return configured
  return !formats?.trim() ? [...ALL_RELAY_REQUEST_FORMATS] : []
}

export const normalizeRelayFormatArray = (formats?: string[] | null): RelayFormat[] => {
  if (!formats?.length) return []

  const normalized = formats
    .map((format) =>
      String(format).trim().toLowerCase() === 'openai' ? 'openai-chat-completions' : format,
    )
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
  return configured.join(',')
}
