import type { ComputedRef, InjectionKey, Ref } from 'vue'
import type {
  CaptchaProviderDto,
  NotificationEventInfoDto,
  TicketAssignmentRuleDto,
} from '@/client/types.gen'

export type ServerConfigSectionName =
  | 'registration'
  | 'billing'
  | 'heartbeat'
  | 'remoteTerminalUnbind'
  | 'notification'
  | 'captcha'
  | 'modelRate'
  | 'smtp'
  | 'site'
  | 'socialAuth'
  | 'errorDecay'
  | 'errorWeights'
  | 'ipBan'
  | 'relayProxy'

export interface ServerConfigWeightRow {
  code: string
  weight: number
  description: string
}

export interface ServerConfigCaptchaOption {
  value: CaptchaProviderDto
  label: string
  description: string
}

export interface ServerConfigCaptchaFallbackOption extends ServerConfigCaptchaOption {
  disabled: boolean
}

export interface ServerConfigContext {
  activeNames: Ref<ServerConfigSectionName[]>
  loading: Ref<boolean>
  savingReg: Ref<boolean>
  regEnabled: Ref<boolean>
  maxAccountsPerEmail: Ref<number>
  defaultGroupUsername: Ref<string>
  codeExpiry: Ref<number>
  groups: Ref<any[]>
  saveRegistration: () => Promise<void>
  savingBilling: Ref<boolean>
  rechargeRatio: Ref<number>
  giftCodeEnabled: Ref<boolean>
  directTransferEnabled: Ref<boolean>
  giftCodeFeePercent: Ref<number>
  directTransferFeePercent: Ref<number>
  giftCodeCancelFeeRefundPercent: Ref<number>
  saveBilling: () => Promise<void>
  savingHeartbeat: Ref<boolean>
  heartbeatIntervalSeconds: Ref<number>
  heartbeatTimeoutSeconds: Ref<number>
  saveHeartbeat: () => Promise<void>
  savingRemoteTerminalUnbind: Ref<boolean>
  remoteTerminalUnbindMaxCount: Ref<number>
  remoteTerminalUnbindWindowHours: Ref<number>
  remoteTerminalRebindCooldownMinutes: Ref<number>
  saveRemoteTerminalUnbind: () => Promise<void>
  savingNotification: Ref<boolean>
  notificationDefaultSubscribedEvents: Ref<string[]>
  notificationDefaultThresholds: Ref<Record<string, number>>
  notificationEventOptions: Ref<NotificationEventInfoDto[]>
  notificationThresholdEventOptions: ComputedRef<NotificationEventInfoDto[]>
  notificationTicketAssignmentRules: Ref<TicketAssignmentRuleDto[]>
  getEventDisplayLabel: (eventType: string) => string
  getThresholdUnitLabel: (eventType: string) => string | undefined
  selectAllNotificationDefaultEvents: () => void
  clearAllNotificationDefaultEvents: () => void
  saveNotification: () => Promise<void>
  savingCaptcha: Ref<boolean>
  captchaProvider: Ref<CaptchaProviderDto>
  captchaFallbackProvider: Ref<CaptchaProviderDto>
  captchaMinScore: Ref<number>
  captchaTrustWindowMinutes: Ref<number>
  isRecaptchaScoreActive: ComputedRef<boolean>
  captchaProviderOptions: ComputedRef<ServerConfigCaptchaOption[]>
  captchaFallbackOptions: ComputedRef<ServerConfigCaptchaFallbackOption[]>
  saveCaptcha: () => Promise<void>
  savingSmtp: Ref<boolean>
  smtpHost: Ref<string>
  smtpPort: Ref<number>
  smtpSecure: Ref<boolean>
  smtpUser: Ref<string>
  smtpPassword: Ref<string>
  smtpSenderName: Ref<string>
  smtpSenderEmail: Ref<string>
  saveSmtp: () => Promise<void>
  savingSite: Ref<boolean>
  siteBackendPublicUrl: Ref<string>
  saveSite: () => Promise<void>
  savingSocialAuth: Ref<boolean>
  socAuthFrontendBaseUrl: Ref<string>
  socAuthQrLoginEnabled: Ref<boolean>
  socAuthStateTtlSeconds: Ref<number>
  socAuthQrLoginTtlSeconds: Ref<number>
  socAuthQrLoginPollIntervalSeconds: Ref<number>
  socAuthGithubEnabled: Ref<boolean>
  socAuthGithubClientId: Ref<string>
  socAuthGithubClientSecret: Ref<string>
  socAuthWechatOpenEnabled: Ref<boolean>
  socAuthWechatOpenAppId: Ref<string>
  socAuthWechatOpenAppSecret: Ref<string>
  socAuthWechatWebEnabled: Ref<boolean>
  socAuthWechatWebAppId: Ref<string>
  socAuthWechatWebAppSecret: Ref<string>
  saveSocialAuth: () => Promise<void>
  savingErrorDecay: Ref<boolean>
  errorDecayEnabled: Ref<boolean>
  errorDecayRate: Ref<number>
  errorDecayMinThreshold: Ref<number>
  errorDecayInterval: Ref<number>
  saveErrorDecay: () => Promise<void>
  savingErrorWeights: Ref<boolean>
  statusCodeWeights: Ref<ServerConfigWeightRow[]>
  customCodeWeights: Ref<ServerConfigWeightRow[]>
  saveErrorWeights: () => Promise<void>
  savingIpBan: Ref<boolean>
  ipBanEnabled: Ref<boolean>
  level1Threshold: Ref<number>
  level1Duration: Ref<number>
  level2Threshold: Ref<number>
  level2Duration: Ref<number>
  level3Threshold: Ref<number>
  level3Duration: Ref<number>
  saveIpBan: () => Promise<void>
  savingRelayProxy: Ref<boolean>
  relayProxyEnabled: Ref<boolean>
  relayProxyUrl: Ref<string>
  saveRelayProxy: () => Promise<void>
}

export const serverConfigContextKey: InjectionKey<ServerConfigContext> =
  Symbol('serverConfigContext')
