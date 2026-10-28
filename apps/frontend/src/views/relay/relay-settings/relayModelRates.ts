import { serializeRelayFormats, toConfiguredRelayFormats } from '@/utils/relay-formats'

export type ModelRateRow = {
  model: string
  modelId: string
  pricingType?: 'token-based' | 'per-request'
  inputPrice: number
  outputPrice: number
  fixedPrice?: number
  cacheCreationMultiplier: number
  cacheReadMultiplier: number
  supportedFormats: string[] | string
}

type ModelIdentitySource = {
  model?: string | null
  modelId?: string | null
  provider?: string | null
}

export const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/

export const resolveModelId = (source: ModelIdentitySource): string => {
  const explicit = source.modelId?.trim()
  if (explicit) return explicit
  return source.provider?.trim() || source.model?.trim() || ''
}

export const normalizeSupportedFormats = (formats?: string | null): string[] =>
  toConfiguredRelayFormats(formats)
export const serializeSupportedFormats = (formats: string[] | string): string =>
  serializeRelayFormats(formats)
