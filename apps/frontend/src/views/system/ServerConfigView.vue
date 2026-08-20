<template>
  <div :class="isDesktop ? 'desktop-page' : 'mobile-page server-config-mobile-adapter'">
    <div
      :class="['server-config', isDesktop ? 'server-config-desktop' : 'server-config-mobile']"
      v-loading="loading"
    >
      <ServerConfigCollapseContent :is-desktop="isDesktop" />
    </div>
  </div>
</template>

<script setup lang="ts">
import ServerConfigCollapseContent from './server-config/components/ServerConfigCollapseContent.vue'
import { usePageDevice } from '@/composables/usePageDevice'
import { computed, onMounted, provide, ref, watch, type Ref } from 'vue'
import { i18ns } from '@/locales'
import { ElMessage } from 'element-plus'
import { configService } from '@/service/configService'
import { groupService } from '@/service/groupService'
import { NotificationService } from '@/service/notificationService'
import {
  getNotificationEventLabel,
  getNotificationThresholdUnit,
} from '@/utils/notification-event-i18n'
import type {
  CaptchaProviderDto,
  NotificationEventInfoDto,
  TicketAssignmentRuleDto,
} from '@/client/types.gen'
import {
  serverConfigContextKey,
  type ServerConfigContext,
  type ServerConfigSectionName,
} from './server-config/context'

const loading = ref(false)
const activeNames: Ref<ServerConfigSectionName[]> = ref([])

// Registration
const savingReg = ref(false)
const regEnabled = ref(false)
const maxAccountsPerEmail = ref(3)
const defaultGroupUsername = ref('user')
const codeExpiry = ref(300)
const groups = ref<any[]>([])

// Billing
const savingBilling = ref(false)
const rechargeRatio = ref(100)
const giftCodeEnabled = ref(true)
const directTransferEnabled = ref(true)
const giftCodeFeePercent = ref(0)
const directTransferFeePercent = ref(0)
const giftCodeCancelFeeRefundPercent = ref(0)

// Heartbeat
const savingHeartbeat = ref(false)
const heartbeatIntervalSeconds = ref(30)
const heartbeatTimeoutSeconds = ref(90)

// Remote terminal unbind
const savingRemoteTerminalUnbind = ref(false)
const remoteTerminalUnbindMaxCount = ref(0)
const remoteTerminalUnbindWindowHours = ref(24)
const remoteTerminalRebindCooldownMinutes = ref(0)

// Notification
const savingNotification = ref(false)
const notificationDefaultSubscribedEvents = ref<string[]>([])
const notificationDefaultThresholds = ref<Record<string, number>>({})
const notificationEventOptions = ref<NotificationEventInfoDto[]>([])
const notificationTicketAssignmentRules = ref<TicketAssignmentRuleDto[]>([])

// Captcha
const savingCaptcha = ref(false)
const captchaProvider = ref<CaptchaProviderDto>('none')
const captchaFallbackProvider = ref<CaptchaProviderDto>('none')
const captchaMinScore = ref(0.5)
const captchaTrustWindowMinutes = ref(30)

// SMTP
const savingSmtp = ref(false)
const smtpHost = ref('')
const smtpPort = ref(465)
const smtpSecure = ref(true)
const smtpUser = ref('')
const smtpPassword = ref('')
const smtpSenderName = ref('AppSystem')
const smtpSenderEmail = ref('')

// Site
const savingSite = ref(false)
const siteBackendPublicUrl = ref('')

// Error Decay
const savingErrorDecay = ref(false)
const errorDecayEnabled = ref(false)
const errorDecayRate = ref(5)
const errorDecayMinThreshold = ref(0.1)
const errorDecayInterval = ref(1)

// Error Weights
const savingErrorWeights = ref(false)
const statusCodeWeights = ref([
  { code: '400', weight: 1, description: 'Bad Request' },
  { code: '401', weight: 2, description: 'Unauthorized' },
  { code: '403', weight: 2, description: 'Forbidden' },
  { code: '429', weight: 5, description: 'Too Many Requests' },
  { code: '500', weight: 3, description: 'Internal Server Error' },
])
const customCodeWeights = ref([{ code: '1001', weight: 1, description: 'Custom Error' }])

// IP Ban
const savingIpBan = ref(false)
const ipBanEnabled = ref(false)
const level1Threshold = ref(10)
const level1Duration = ref(3600)
const level2Threshold = ref(20)
const level2Duration = ref(86400)
const level3Threshold = ref(50)
const level3Duration = ref(-1)

// Relay upstream proxy
const savingRelayProxy = ref(false)
const relayProxyEnabled = ref(false)
const relayProxyUrl = ref('')
const relayProxyLoaded = ref(false)

// Social Auth
const savingSocialAuth = ref(false)
const socAuthFrontendBaseUrl = ref('')
const socAuthQrLoginEnabled = ref(false)
const socAuthStateTtlSeconds = ref(300)
const socAuthQrLoginTtlSeconds = ref(300)
const socAuthQrLoginPollIntervalSeconds = ref(3)
const socAuthGithubEnabled = ref(false)
const socAuthGithubClientId = ref('')
const socAuthGithubClientSecret = ref('')
const socAuthWechatOpenEnabled = ref(false)
const socAuthWechatOpenAppId = ref('')
const socAuthWechatOpenAppSecret = ref('')
const socAuthWechatWebEnabled = ref(false)
const socAuthWechatWebAppId = ref('')
const socAuthWechatWebAppSecret = ref('')

// Loaded flags
const registrationLoaded = ref(false)
const billingLoaded = ref(false)
const heartbeatLoaded = ref(false)
const remoteTerminalUnbindLoaded = ref(false)
const notificationLoaded = ref(false)
const captchaLoaded = ref(false)
const smtpLoaded = ref(false)
const siteLoaded = ref(false)
const socialAuthLoaded = ref(false)
const errorDecayLoaded = ref(false)
const errorWeightsLoaded = ref(false)
const ipBanLoaded = ref(false)

const isRecaptchaScoreActive = computed(
  () => captchaProvider.value === 'recaptcha' || captchaFallbackProvider.value === 'recaptcha',
)

const captchaProviderOptions = computed(() => [
  {
    value: 'none' as CaptchaProviderDto,
    label: 'none',
    description: i18ns.t('ServerConfigView.captchaProviderNoneDesc'),
  },
  {
    value: 'recaptcha' as CaptchaProviderDto,
    label: 'reCAPTCHA',
    description: i18ns.t('ServerConfigView.captchaProviderRecaptchaDesc'),
  },
  {
    value: 'turnstile' as CaptchaProviderDto,
    label: 'Turnstile',
    description: i18ns.t('ServerConfigView.captchaProviderTurnstileDesc'),
  },
])

const captchaFallbackOptions = computed(() =>
  captchaProviderOptions.value.map((option) => ({
    ...option,
    disabled: option.value !== 'none' && option.value === captchaProvider.value,
  })),
)

const notificationService = NotificationService.getInstance()

const notificationThresholdEventOptions = computed(() =>
  notificationEventOptions.value.filter((event) => event.hasThreshold),
)

const getEventDisplayLabel = (eventType: string) => getNotificationEventLabel(eventType)

const getThresholdUnitLabel = (eventType: string) => getNotificationThresholdUnit(eventType)

const normalizeNotificationThresholds = (
  thresholds: Record<string, number>,
  events: NotificationEventInfoDto[],
) => {
  const thresholdEvents = events.filter((event) => event.hasThreshold)
  const normalized: Record<string, number> = {}

  thresholdEvents.forEach((event) => {
    const value = thresholds[event.value]
    normalized[event.value] =
      typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
  })

  return normalized
}

const selectAllNotificationDefaultEvents = () => {
  notificationDefaultSubscribedEvents.value = notificationEventOptions.value.map(
    (event) => event.value,
  )
}

const clearAllNotificationDefaultEvents = () => {
  notificationDefaultSubscribedEvents.value = []
}

const loadRegistrationConfig = async () => {
  if (registrationLoaded.value) return
  try {
    const [regConfig, groupData] = await Promise.all([
      configService.getRegistrationConfig(),
      groupService.getAllGroups(),
    ])
    regEnabled.value = regConfig.enabled
    maxAccountsPerEmail.value = regConfig.maxAccountsPerEmail
    defaultGroupUsername.value = regConfig.defaultGroupUsername
    codeExpiry.value = regConfig.verificationCodeExpiry
    groups.value = Array.isArray(groupData) ? groupData : groupData.groups
    registrationLoaded.value = true
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('relay.loadFailed'))
  }
}

const loadBillingConfig = async () => {
  if (billingLoaded.value) return
  try {
    const billingConfig = await configService.getBillingConfig()
    rechargeRatio.value = billingConfig.rechargeRatio
    giftCodeEnabled.value = billingConfig.giftCodeEnabled
    directTransferEnabled.value = billingConfig.directTransferEnabled
    giftCodeFeePercent.value = billingConfig.giftCodeFeePercent
    directTransferFeePercent.value = billingConfig.directTransferFeePercent
    giftCodeCancelFeeRefundPercent.value = billingConfig.giftCodeCancelFeeRefundPercent
    billingLoaded.value = true
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('relay.loadFailed'))
  }
}

const loadHeartbeatConfig = async () => {
  if (heartbeatLoaded.value) return
  try {
    const heartbeatConfig = await configService.getHeartbeatConfig()
    heartbeatIntervalSeconds.value = heartbeatConfig.intervalSeconds
    heartbeatTimeoutSeconds.value = heartbeatConfig.timeoutSeconds
    heartbeatLoaded.value = true
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('ServerConfigView.loadFailed'))
  }
}

const loadRemoteTerminalUnbindConfig = async () => {
  if (remoteTerminalUnbindLoaded.value) return
  try {
    const remoteTerminalUnbindConfig = await configService.getRemoteTerminalUnbindConfig()
    remoteTerminalUnbindMaxCount.value = remoteTerminalUnbindConfig.maxCount
    remoteTerminalUnbindWindowHours.value = remoteTerminalUnbindConfig.windowHours
    remoteTerminalRebindCooldownMinutes.value = remoteTerminalUnbindConfig.rebindCooldownMinutes
    remoteTerminalUnbindLoaded.value = true
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('ServerConfigView.loadFailed'))
  }
}

const loadNotificationConfig = async () => {
  if (notificationLoaded.value) return
  try {
    const [notificationConfig, eventResult] = await Promise.all([
      configService.getNotificationConfig(),
      notificationService.getEventList(),
    ])
    const events = Array.isArray(eventResult.data)
      ? (eventResult.data as NotificationEventInfoDto[])
      : []
    notificationEventOptions.value = events
    notificationDefaultSubscribedEvents.value = notificationConfig.defaultSubscribedEvents.filter(
      (event) => events.some((item: NotificationEventInfoDto) => item.value === event),
    )
    notificationDefaultThresholds.value = normalizeNotificationThresholds(
      notificationConfig.defaultThresholds,
      events,
    )
    notificationTicketAssignmentRules.value = Array.isArray(
      notificationConfig.ticketAssignmentRules,
    )
      ? notificationConfig.ticketAssignmentRules
      : []
    notificationLoaded.value = true
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('ServerConfigView.loadFailed'))
  }
}

const loadCaptchaConfig = async () => {
  if (captchaLoaded.value) return
  try {
    const captchaConfig = await configService.getCaptchaConfig()
    captchaProvider.value = captchaConfig.provider
    captchaFallbackProvider.value = captchaConfig.fallbackProvider
    captchaMinScore.value = captchaConfig.minScore
    captchaTrustWindowMinutes.value = captchaConfig.trustWindowMinutes
    captchaLoaded.value = true
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('ServerConfigView.loadFailed'))
  }
}

const loadSmtpConfig = async () => {
  if (smtpLoaded.value) return
  try {
    const smtpConfig = await configService.getSmtpConfig()
    smtpHost.value = smtpConfig.host
    smtpPort.value = smtpConfig.port
    smtpSecure.value = smtpConfig.secure
    smtpUser.value = smtpConfig.user
    smtpPassword.value = smtpConfig.password
    smtpSenderName.value = smtpConfig.senderName
    smtpSenderEmail.value = smtpConfig.senderEmail
    smtpLoaded.value = true
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('relay.loadFailed'))
  }
}

const loadSiteConfig = async () => {
  if (siteLoaded.value) return
  try {
    const siteConfig = await configService.getSiteConfig()
    siteBackendPublicUrl.value = siteConfig.backendPublicUrl
    siteLoaded.value = true
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('relay.loadFailed'))
  }
}

const loadErrorDecayConfig = async () => {
  if (errorDecayLoaded.value) return
  try {
    const configs = await configService.getConfigs([
      'ipBan.errorDecayEnabled',
      'ipBan.errorDecayRate',
      'ipBan.errorDecayMinThreshold',
      'ipBan.errorDecayInterval',
    ])
    errorDecayEnabled.value = configs['ipBan.errorDecayEnabled'] === 'true'
    errorDecayRate.value = parseFloat(configs['ipBan.errorDecayRate'] || '5')
    errorDecayMinThreshold.value = parseFloat(configs['ipBan.errorDecayMinThreshold'] || '0.1')
    errorDecayInterval.value = parseInt(configs['ipBan.errorDecayInterval'] || '1', 10)
    errorDecayLoaded.value = true
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('relay.loadFailed'))
  }
}

const loadErrorWeightsConfig = async () => {
  if (errorWeightsLoaded.value) return
  try {
    const configs = await configService.getConfigs(['ipBan.errorWeights'])
    const errorWeightsJson = configs['ipBan.errorWeights']
    if (errorWeightsJson) {
      try {
        const weights = JSON.parse(errorWeightsJson)
        if (weights.statusCodeWeights) {
          statusCodeWeights.value = Object.entries(weights.statusCodeWeights).map(
            ([code, weight]) => ({ code, weight: weight as number, description: '' }),
          )
        }
        if (weights.customCodeWeights) {
          customCodeWeights.value = Object.entries(weights.customCodeWeights).map(
            ([code, weight]) => ({ code, weight: weight as number, description: '' }),
          )
        }
      } catch {}
    }
    errorWeightsLoaded.value = true
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('relay.loadFailed'))
  }
}

const loadSocialAuthConfig = async () => {
  if (socialAuthLoaded.value) return
  try {
    const config = await configService.getSocialAuthConfig()
    socAuthFrontendBaseUrl.value = config.frontendBaseUrl
    socAuthQrLoginEnabled.value = config.qrLoginEnabled
    socAuthStateTtlSeconds.value = config.stateTtlSeconds
    socAuthQrLoginTtlSeconds.value = config.qrLoginTtlSeconds
    socAuthQrLoginPollIntervalSeconds.value = config.qrLoginPollIntervalSeconds
    socAuthGithubEnabled.value = config.github?.enabled ?? false
    socAuthGithubClientId.value = config.github?.clientId ?? ''
    socAuthGithubClientSecret.value = config.github?.clientSecret ?? ''
    socAuthWechatOpenEnabled.value = config.wechatOpen?.enabled ?? false
    socAuthWechatOpenAppId.value = config.wechatOpen?.appId ?? ''
    socAuthWechatOpenAppSecret.value = config.wechatOpen?.appSecret ?? ''
    socAuthWechatWebEnabled.value = config.wechatWeb?.enabled ?? false
    socAuthWechatWebAppId.value = config.wechatWeb?.appId ?? ''
    socAuthWechatWebAppSecret.value = config.wechatWeb?.appSecret ?? ''
    socialAuthLoaded.value = true
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('relay.loadFailed'))
  }
}

const loadIpBanConfig = async () => {
  if (ipBanLoaded.value) return
  try {
    const ipBanConfig = await configService.getIpBanConfig()
    ipBanEnabled.value = ipBanConfig.enabled
    level1Threshold.value = ipBanConfig.level1Threshold
    level1Duration.value = ipBanConfig.level1Duration
    level2Threshold.value = ipBanConfig.level2Threshold
    level2Duration.value = ipBanConfig.level2Duration
    level3Threshold.value = ipBanConfig.level3Threshold
    level3Duration.value = ipBanConfig.level3Duration
    ipBanLoaded.value = true
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('relay.loadFailed'))
  }
}

const loadRelayProxyConfig = async () => {
  if (relayProxyLoaded.value) return
  try {
    const config = await configService.getRelayProxyConfig()
    relayProxyEnabled.value = config.enabled
    relayProxyUrl.value = config.url
    relayProxyLoaded.value = true
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('ServerConfigView.loadFailed'))
  }
}

const saveRelayProxy = async () => {
  savingRelayProxy.value = true
  try {
    await configService.setRelayProxyConfig({ enabled: relayProxyEnabled.value, url: relayProxyUrl.value.trim() })
    ElMessage.success(i18ns.t('ServerConfigView.saveSuccess'))
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('ServerConfigView.saveFailed'))
  } finally {
    savingRelayProxy.value = false
  }
}

const saveRegistration = async () => {
  savingReg.value = true
  try {
    await configService.setRegistrationConfig({
      enabled: regEnabled.value,
      maxAccountsPerEmail: maxAccountsPerEmail.value,
      defaultGroupUsername: defaultGroupUsername.value,
      verificationCodeExpiry: codeExpiry.value,
    })
    ElMessage.success(i18ns.t('ServerConfigView.saveSuccess'))
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('ServerConfigView.saveFailed'))
  } finally {
    savingReg.value = false
  }
}

const saveBilling = async () => {
  savingBilling.value = true
  try {
    await configService.setBillingConfig({
      rechargeRatio: rechargeRatio.value,
      giftCodeEnabled: giftCodeEnabled.value,
      directTransferEnabled: directTransferEnabled.value,
      giftCodeFeePercent: giftCodeFeePercent.value,
      directTransferFeePercent: directTransferFeePercent.value,
      giftCodeCancelFeeRefundPercent: giftCodeCancelFeeRefundPercent.value,
    })
    ElMessage.success(i18ns.t('ServerConfigView.saveSuccess'))
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('ServerConfigView.saveFailed'))
  } finally {
    savingBilling.value = false
  }
}

const saveHeartbeat = async () => {
  savingHeartbeat.value = true
  try {
    await configService.setHeartbeatConfig({
      intervalSeconds: heartbeatIntervalSeconds.value,
      timeoutSeconds: heartbeatTimeoutSeconds.value,
    })
    ElMessage.success(i18ns.t('ServerConfigView.saveSuccess'))
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('ServerConfigView.saveFailed'))
  } finally {
    savingHeartbeat.value = false
  }
}

const saveRemoteTerminalUnbind = async () => {
  savingRemoteTerminalUnbind.value = true
  try {
    await configService.setRemoteTerminalUnbindConfig({
      maxCount: remoteTerminalUnbindMaxCount.value,
      windowHours: remoteTerminalUnbindWindowHours.value,
      rebindCooldownMinutes: remoteTerminalRebindCooldownMinutes.value,
    })
    ElMessage.success(i18ns.t('ServerConfigView.saveSuccess'))
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('ServerConfigView.saveFailed'))
  } finally {
    savingRemoteTerminalUnbind.value = false
  }
}

const saveNotification = async () => {
  savingNotification.value = true
  try {
    await configService.setNotificationConfig({
      defaultSubscribedEvents: notificationDefaultSubscribedEvents.value,
      defaultThresholds: notificationDefaultThresholds.value,
      ticketAssignmentRules: notificationTicketAssignmentRules.value,
    })
    ElMessage.success(i18ns.t('ServerConfigView.saveSuccess'))
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('ServerConfigView.saveFailed'))
  } finally {
    savingNotification.value = false
  }
}

const saveCaptcha = async () => {
  if (captchaProvider.value === 'none' && captchaFallbackProvider.value !== 'none') {
    ElMessage.warning(i18ns.t('ServerConfigView.captchaProviderRequired'))
    return
  }

  if (captchaProvider.value !== 'none' && captchaFallbackProvider.value === captchaProvider.value) {
    ElMessage.warning(i18ns.t('ServerConfigView.captchaFallbackDistinct'))
    return
  }

  savingCaptcha.value = true
  try {
    await configService.setCaptchaConfig({
      provider: captchaProvider.value,
      fallbackProvider: captchaFallbackProvider.value,
      minScore: captchaMinScore.value,
      trustWindowMinutes: captchaTrustWindowMinutes.value,
    })
    ElMessage.success(i18ns.t('ServerConfigView.saveSuccess'))
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('ServerConfigView.saveFailed'))
  } finally {
    savingCaptcha.value = false
  }
}

watch(captchaProvider, (provider) => {
  if (provider === 'none') {
    captchaFallbackProvider.value = 'none'
    return
  }

  if (captchaFallbackProvider.value === provider) {
    captchaFallbackProvider.value = 'none'
  }
})

const saveSmtp = async () => {
  savingSmtp.value = true
  try {
    await configService.setSmtpConfig({
      host: smtpHost.value,
      port: smtpPort.value,
      secure: smtpSecure.value,
      user: smtpUser.value,
      password: smtpPassword.value,
      senderName: smtpSenderName.value,
      senderEmail: smtpSenderEmail.value,
    })
    ElMessage.success(i18ns.t('ServerConfigView.saveSuccess'))
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('ServerConfigView.saveFailed'))
  } finally {
    savingSmtp.value = false
  }
}

const saveSite = async () => {
  savingSite.value = true
  try {
    await configService.setSiteConfig({
      backendPublicUrl: siteBackendPublicUrl.value,
    })
    ElMessage.success(i18ns.t('ServerConfigView.saveSuccess'))
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('ServerConfigView.saveFailed'))
  } finally {
    savingSite.value = false
  }
}

const saveErrorDecay = async () => {
  savingErrorDecay.value = true
  try {
    await configService.setConfigs({
      'ipBan.errorDecayEnabled': String(errorDecayEnabled.value),
      'ipBan.errorDecayRate': String(errorDecayRate.value),
      'ipBan.errorDecayMinThreshold': String(errorDecayMinThreshold.value),
      'ipBan.errorDecayInterval': String(errorDecayInterval.value),
    })
    ElMessage.success(i18ns.t('ServerConfigView.saveSuccess'))
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('ServerConfigView.saveFailed'))
  } finally {
    savingErrorDecay.value = false
  }
}

const saveErrorWeights = async () => {
  savingErrorWeights.value = true
  try {
    const weights = {
      statusCodeWeights: Object.fromEntries(
        statusCodeWeights.value.map((item) => [item.code, item.weight]),
      ),
      customCodeWeights: Object.fromEntries(
        customCodeWeights.value.map((item) => [item.code, item.weight]),
      ),
    }
    await configService.setConfigs({
      'ipBan.errorWeights': JSON.stringify(weights),
    })
    ElMessage.success(i18ns.t('ServerConfigView.saveSuccess'))
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('ServerConfigView.saveFailed'))
  } finally {
    savingErrorWeights.value = false
  }
}

const saveSocialAuth = async () => {
  savingSocialAuth.value = true
  try {
    const currentConfig = await configService.getSocialAuthConfig()
    await configService.setSocialAuthConfig({
      frontendBaseUrl: socAuthFrontendBaseUrl.value,
      qrLoginEnabled: socAuthQrLoginEnabled.value,
      stateTtlSeconds: socAuthStateTtlSeconds.value,
      qrLoginTtlSeconds: socAuthQrLoginTtlSeconds.value,
      qrLoginPollIntervalSeconds: socAuthQrLoginPollIntervalSeconds.value,
      github: {
        ...currentConfig.github,
        enabled: socAuthGithubEnabled.value,
        clientId: socAuthGithubClientId.value,
        clientSecret: socAuthGithubClientSecret.value,
      },
      wechatOpen: {
        ...currentConfig.wechatOpen,
        enabled: socAuthWechatOpenEnabled.value,
        appId: socAuthWechatOpenAppId.value,
        appSecret: socAuthWechatOpenAppSecret.value,
      },
      wechatWeb: {
        ...currentConfig.wechatWeb,
        enabled: socAuthWechatWebEnabled.value,
        appId: socAuthWechatWebAppId.value,
        appSecret: socAuthWechatWebAppSecret.value,
      },
    })
    ElMessage.success(i18ns.t('ServerConfigView.saveSuccess'))
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('ServerConfigView.saveFailed'))
  } finally {
    savingSocialAuth.value = false
  }
}

const saveIpBan = async () => {
  savingIpBan.value = true
  try {
    await configService.setIpBanConfig({
      enabled: ipBanEnabled.value,
      level1Threshold: level1Threshold.value,
      level1Duration: level1Duration.value,
      level2Threshold: level2Threshold.value,
      level2Duration: level2Duration.value,
      level3Threshold: level3Threshold.value,
      level3Duration: level3Duration.value,
    })
    ElMessage.success(i18ns.t('ServerConfigView.saveSuccess'))
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('ServerConfigView.saveFailed'))
  } finally {
    savingIpBan.value = false
  }
}

watch(activeNames, (newNames) => {
  if (newNames.includes('socialAuth')) loadSocialAuthConfig()
  if (newNames.includes('registration')) loadRegistrationConfig()
  if (newNames.includes('billing')) loadBillingConfig()
  if (newNames.includes('heartbeat')) loadHeartbeatConfig()
  if (newNames.includes('remoteTerminalUnbind')) loadRemoteTerminalUnbindConfig()
  if (newNames.includes('notification')) loadNotificationConfig()
  if (newNames.includes('captcha')) loadCaptchaConfig()
  if (newNames.includes('smtp')) loadSmtpConfig()
  if (newNames.includes('site')) loadSiteConfig()
  if (newNames.includes('errorDecay')) loadErrorDecayConfig()
  if (newNames.includes('errorWeights')) loadErrorWeightsConfig()
  if (newNames.includes('ipBan')) loadIpBanConfig()
  if (newNames.includes('relayProxy')) loadRelayProxyConfig()
})

onMounted(() => {
  // Load default opened panel
  if (activeNames.value.includes('registration')) loadRegistrationConfig()
})

const serverConfigContext: ServerConfigContext = {
  activeNames,
  loading,
  savingReg,
  regEnabled,
  maxAccountsPerEmail,
  defaultGroupUsername,
  codeExpiry,
  groups,
  saveRegistration,
  savingBilling,
  rechargeRatio,
  giftCodeEnabled,
  directTransferEnabled,
  giftCodeFeePercent,
  directTransferFeePercent,
  giftCodeCancelFeeRefundPercent,
  saveBilling,
  savingHeartbeat,
  heartbeatIntervalSeconds,
  heartbeatTimeoutSeconds,
  saveHeartbeat,
  savingRemoteTerminalUnbind,
  remoteTerminalUnbindMaxCount,
  remoteTerminalUnbindWindowHours,
  remoteTerminalRebindCooldownMinutes,
  saveRemoteTerminalUnbind,
  savingNotification,
  notificationDefaultSubscribedEvents,
  notificationDefaultThresholds,
  notificationEventOptions,
  notificationThresholdEventOptions,
  notificationTicketAssignmentRules,
  getEventDisplayLabel,
  getThresholdUnitLabel,
  selectAllNotificationDefaultEvents,
  clearAllNotificationDefaultEvents,
  saveNotification,
  savingCaptcha,
  captchaProvider,
  captchaFallbackProvider,
  captchaMinScore,
  captchaTrustWindowMinutes,
  isRecaptchaScoreActive,
  captchaProviderOptions,
  captchaFallbackOptions,
  saveCaptcha,
  savingSmtp,
  smtpHost,
  smtpPort,
  smtpSecure,
  smtpUser,
  smtpPassword,
  smtpSenderName,
  smtpSenderEmail,
  saveSmtp,
  savingSite,
  siteBackendPublicUrl,
  saveSite,
  savingSocialAuth,
  socAuthFrontendBaseUrl,
  socAuthQrLoginEnabled,
  socAuthStateTtlSeconds,
  socAuthQrLoginTtlSeconds,
  socAuthQrLoginPollIntervalSeconds,
  socAuthGithubEnabled,
  socAuthGithubClientId,
  socAuthGithubClientSecret,
  socAuthWechatOpenEnabled,
  socAuthWechatOpenAppId,
  socAuthWechatOpenAppSecret,
  socAuthWechatWebEnabled,
  socAuthWechatWebAppId,
  socAuthWechatWebAppSecret,
  saveSocialAuth,
  savingErrorDecay,
  errorDecayEnabled,
  errorDecayRate,
  errorDecayMinThreshold,
  errorDecayInterval,
  saveErrorDecay,
  savingErrorWeights,
  statusCodeWeights,
  customCodeWeights,
  saveErrorWeights,
  savingIpBan,
  ipBanEnabled,
  level1Threshold,
  level1Duration,
  level2Threshold,
  level2Duration,
  level3Threshold,
  level3Duration,
  saveIpBan,
  savingRelayProxy,
  relayProxyEnabled,
  relayProxyUrl,
  saveRelayProxy,
}

provide(serverConfigContextKey, serverConfigContext)

const { isDesktop } = usePageDevice()
</script>

<style scoped src="./server-config/server-config.css"></style>
