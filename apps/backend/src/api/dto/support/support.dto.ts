import type { RelayRequestFormat } from '@appserver/shared'

export interface SupportMessageDto {
  role: 'user' | 'assistant'
  content: string
}

export interface SendSupportMessageDto {
  content: string
  history?: SupportMessageDto[]
  locale?: 'zh-CN' | 'en'
}

export interface SupportCitationDto {
  slug: string
  title: string
  url: string
}

export interface SupportAvailabilityDto {
  enabled: boolean
}

export interface SupportHandoffDto {
  title: string
  description: string
  sourcePage?: string
}

export interface SupportHandoffResultDto {
  ticketId: string
}

export interface SupportAiConfigDto {
  enabled: boolean
  upstreamUrl: string
  apiKeyConfigured: boolean
  model: string
  requestFormat: RelayRequestFormat
  systemPrompt: string
  maxRequests: number
  windowSeconds: number
}

export interface UpdateSupportAiConfigDto {
  enabled: boolean
  upstreamUrl: string
  apiKey?: string
  clearApiKey?: boolean
  model: string
  requestFormat: RelayRequestFormat
  systemPrompt?: string
  maxRequests: number
  windowSeconds: number
}
