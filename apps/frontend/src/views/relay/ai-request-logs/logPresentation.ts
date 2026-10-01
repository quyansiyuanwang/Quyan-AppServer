import { i18ns } from '@/locales'
import type { AiRequestLogListItemDto } from '@/client/types.gen'
export const identityLabel = (row: AiRequestLogListItemDto) =>
  row.username || row.userId || i18ns.t('aiRequestLogs.unrecorded')
export const tokenLabel = (row: AiRequestLogListItemDto) =>
  row.relayTokenName ||
  (row.relayTokenId
    ? i18ns.t('aiRequestLogs.unnamedToken') + ' · ' + row.relayTokenId
    : i18ns.t('aiRequestLogs.unrecorded'))
export const formatBytes = (value?: number | null) =>
  value == null
    ? i18ns.t('aiRequestLogs.unrecorded')
    : value < 1024
      ? value + ' B'
      : value < 1024 * 1024
        ? (value / 1024).toFixed(1) + ' KB'
        : (value / 1024 / 1024).toFixed(2) + ' MB'
export const outcomeKeys = {
  success: 'aiRequestLogs.success',
  failed: 'aiRequestLogs.failed',
  pending: 'aiRequestLogs.pending',
  interrupted: 'aiRequestLogs.interrupted',
} as const satisfies Record<NonNullable<AiRequestLogListItemDto['outcome']>, string>
export const stageKeys = {
  authentication: 'aiRequestLogs.stageAuthentication',
  request: 'aiRequestLogs.stageRequest',
  routing: 'aiRequestLogs.stageRouting',
  upstream: 'aiRequestLogs.stageUpstream',
  'content-safety': 'aiRequestLogs.stageSafety',
  settlement: 'aiRequestLogs.stageSettlement',
  client: 'aiRequestLogs.stageClient',
} as const satisfies Record<NonNullable<AiRequestLogListItemDto['failureStage']>, string>
const sectionKeys = {
  system: 'aiRequestLogs.sectionSystem',
  messages: 'aiRequestLogs.sectionMessages',
  tools: 'aiRequestLogs.sectionTools',
  parameters: 'aiRequestLogs.sectionParameters',
  output: 'aiRequestLogs.sectionOutput',
  usage: 'aiRequestLogs.sectionUsage',
  errors: 'aiRequestLogs.sectionErrors',
  events: 'aiRequestLogs.sectionEvents',
  other: 'aiRequestLogs.sectionOther',
} as const
const authKeys = {
  unknown: 'aiRequestLogs.authUnknown',
  identified: 'aiRequestLogs.authIdentified',
  authenticated: 'aiRequestLogs.authAuthenticated',
  rejected: 'aiRequestLogs.authRejected',
} as const
export const omissionKeys = {
  'unknown-identity': 'aiRequestLogs.omissionUnknown',
  'invalid-body': 'aiRequestLogs.omissionInvalid',
  'request-too-large': 'aiRequestLogs.omissionTooLarge',
  'not-recorded': 'aiRequestLogs.omissionNotRecorded',
} as const satisfies Record<NonNullable<AiRequestLogListItemDto['bodyOmissionReason']>, string>
export const outcomeLabel = (value?: string | null) =>
  i18ns.t(outcomeKeys[value as keyof typeof outcomeKeys] ?? 'aiRequestLogs.unrecorded')
export const stageLabel = (value?: string | null) =>
  i18ns.t(stageKeys[value as keyof typeof stageKeys] ?? 'aiRequestLogs.unrecorded')
export const sectionLabel = (value: string) =>
  i18ns.t(sectionKeys[value as keyof typeof sectionKeys] ?? 'aiRequestLogs.sectionOther')
export const authLabel = (value?: string | null) =>
  i18ns.t(authKeys[value as keyof typeof authKeys] ?? 'aiRequestLogs.unrecorded')
export const omissionLabel = (value?: string | null) =>
  i18ns.t(omissionKeys[value as keyof typeof omissionKeys] ?? 'aiRequestLogs.noContent')
