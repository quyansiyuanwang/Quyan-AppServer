import { useRequestStore } from '@/stores/request'
import { CustomCode } from '@/constant/custom-code'
import { toServiceError } from '@/utils/error-utils'
import type {
  CaptchaConfigDto,
  HeartbeatConfigDto,
  NotificationConfigDto,
  PublicSocialAuthConfigDto,
  RecordStringString,
  RemoteTerminalUnbindConfigDto,
  SetCaptchaConfigDto,
  SetHeartbeatConfigDto,
  SetIpBanConfigDto,
  SetNotificationConfigDto,
  SetRegistrationConfigDto,
  SetRelayConfigDto,
  SetSiteConfigDto,
  SetSmtpConfigDto,
  SetRemoteTerminalUnbindConfigDto,
  SetSocialAuthConfigDto,
  RelayProxyConfigDto,
  SetRelayProxyConfigDto,
  SiteConfigDto,
  SocialAuthConfigDto,
} from '@/client/types.gen'
import { cacheObject } from '@/utils/common'
import { createConfigControllerApi } from '@/client/services/config-controller.gen'

const configApi = cacheObject(() => createConfigControllerApi(useRequestStore().getAxios()))

export interface BillingConfigDto {
  rechargeRatio: number
  giftCodeEnabled: boolean
  directTransferEnabled: boolean
  giftCodeFeePercent: number
  directTransferFeePercent: number
  giftCodeCancelFeeRefundPercent: number
}

export interface RelayConfigDto {
  upstreamUrl: string
  upstreamApiKey: string
  allowedModels: string
  customKeyEnabled: boolean
  customKeyMaxTokensPerUser: number
  customKeyCreateLimitWindowMinutes: number
  customKeyCreateLimitMaxCount: number
}

export interface SetBillingConfigDto {
  rechargeRatio: number
  giftCodeEnabled: boolean
  directTransferEnabled: boolean
  giftCodeFeePercent: number
  directTransferFeePercent: number
  giftCodeCancelFeeRefundPercent: number
}

export class ConfigService {
  private static instance: ConfigService | null = null

  private constructor() {}

  static getInstance() {
    if (!this.instance) {
      this.instance = new ConfigService()
    }
    return this.instance
  }

  async getAllConfigs() {
    const result = await configApi.getAllConfigs({})
    if (result && result.code === CustomCode.OK && result.data) {
      return result.data.configs
    }
    throw toServiceError(result)
  }

  async getConfigs(keys: string[]) {
    const allConfigs = await this.getAllConfigs()
    const result: RecordStringString = {}
    keys.forEach((key) => {
      if (allConfigs[key] !== undefined) {
        result[key] = allConfigs[key]
      }
    })
    return result
  }

  async setConfigs(configs: RecordStringString) {
    const result = await configApi.setConfigs({ body: { configs } })
    if (result && result.code === CustomCode.OK) {
      return true
    }
    throw toServiceError(result)
  }

  async getRegistrationStatus(): Promise<boolean> {
    const result = await configApi.getRegistrationStatus({})
    if (result && result.code === CustomCode.OK && result.data) {
      return result.data.enabled
    }
    return false
  }

  async getRegistrationConfig() {
    const result = await configApi.getRegistrationConfig({})
    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }
    throw toServiceError(result)
  }

  async getRelayConfig(): Promise<RelayConfigDto> {
    const result = await configApi.getRelayConfig({})
    if (result && result.code === CustomCode.OK && result.data) {
      return result.data as RelayConfigDto
    }
    throw toServiceError(result)
  }

  async getRelayProxyConfig(): Promise<RelayProxyConfigDto> {
    const result = await configApi.getRelayProxyConfig({})
    if (result && result.code === CustomCode.OK && result.data)
      return result.data as RelayProxyConfigDto
    throw toServiceError(result)
  }

  async getSmtpConfig() {
    const result = await configApi.getSmtpConfig({})
    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }
    throw toServiceError(result)
  }

  async getSiteConfig(): Promise<SiteConfigDto> {
    const result = await configApi.getSiteConfig({})
    if (result && result.code === CustomCode.OK && result.data) {
      return result.data as SiteConfigDto
    }
    throw toServiceError(result)
  }

  async getIpBanConfig() {
    const result = await configApi.getIpBanConfig({})
    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }
    throw toServiceError(result)
  }

  async getBillingConfig(): Promise<BillingConfigDto> {
    const result = await configApi.getBillingConfig({})
    if (result && result.code === CustomCode.OK && result.data) {
      return result.data as BillingConfigDto
    }
    throw toServiceError(result)
  }

  async getCaptchaConfig(): Promise<CaptchaConfigDto> {
    const result = await configApi.getCaptchaConfig({})
    if (result && result.code === CustomCode.OK && result.data) {
      return result.data as CaptchaConfigDto
    }
    throw toServiceError(result)
  }

  async getHeartbeatConfig(): Promise<HeartbeatConfigDto> {
    const result = await configApi.getHeartbeatConfig({})
    if (result && result.code === CustomCode.OK && result.data) {
      return result.data as HeartbeatConfigDto
    }
    throw toServiceError(result)
  }

  async getRemoteTerminalUnbindConfig(): Promise<RemoteTerminalUnbindConfigDto> {
    const result = await configApi.getRemoteTerminalUnbindConfig({})
    if (result && result.code === CustomCode.OK && result.data) {
      return result.data as RemoteTerminalUnbindConfigDto
    }
    throw toServiceError(result)
  }

  async getNotificationConfig(): Promise<NotificationConfigDto> {
    const result = await configApi.getNotificationConfig({})
    if (result && result.code === CustomCode.OK && result.data) {
      return result.data as NotificationConfigDto
    }
    throw toServiceError(result)
  }

  async setRegistrationConfig(config: SetRegistrationConfigDto) {
    const result = await configApi.setRegistrationConfig({
      body: config,
    })
    if (result && result.code === CustomCode.OK) {
      return true
    }
    throw toServiceError(result)
  }

  async setRelayConfig(config: SetRelayConfigDto) {
    const result = await configApi.setRelayConfig({ body: config })
    if (result && result.code === CustomCode.OK) {
      return true
    }
    throw toServiceError(result)
  }

  async setRelayProxyConfig(config: SetRelayProxyConfigDto) {
    const result = await configApi.setRelayProxyConfig({ body: config })
    if (result && result.code === CustomCode.OK) return true
    throw toServiceError(result)
  }

  async setSmtpConfig(config: SetSmtpConfigDto) {
    const result = await configApi.setSmtpConfig({ body: config })
    if (result && result.code === CustomCode.OK) {
      return true
    }
    throw toServiceError(result)
  }

  async setSiteConfig(config: SetSiteConfigDto) {
    const result = await configApi.setSiteConfig({ body: config })
    if (result && result.code === CustomCode.OK) {
      return true
    }
    throw toServiceError(result)
  }

  async setIpBanConfig(config: SetIpBanConfigDto) {
    const result = await configApi.setIpBanConfig({ body: config })
    if (result && result.code === CustomCode.OK) {
      return true
    }
    throw toServiceError(result)
  }

  async setBillingConfig(config: SetBillingConfigDto) {
    const result = await configApi.setBillingConfig({ body: config })
    if (result && result.code === CustomCode.OK) {
      return true
    }
    throw toServiceError(result)
  }

  async setCaptchaConfig(config: SetCaptchaConfigDto) {
    const result = await configApi.setCaptchaConfig({ body: config })
    if (result && result.code === CustomCode.OK) {
      return true
    }
    throw toServiceError(result)
  }

  async setHeartbeatConfig(config: SetHeartbeatConfigDto) {
    const result = await configApi.setHeartbeatConfig({ body: config })
    if (result && result.code === CustomCode.OK) {
      return true
    }
    throw toServiceError(result)
  }

  async setRemoteTerminalUnbindConfig(config: SetRemoteTerminalUnbindConfigDto) {
    const result = await configApi.setRemoteTerminalUnbindConfig({ body: config })
    if (result && result.code === CustomCode.OK) {
      return true
    }
    throw toServiceError(result)
  }

  async setNotificationConfig(config: SetNotificationConfigDto) {
    const result = await configApi.setNotificationConfig({ body: config })
    if (result && result.code === CustomCode.OK) {
      return true
    }
    throw toServiceError(result)
  }

  async getPublicSocialAuthConfig(): Promise<PublicSocialAuthConfigDto> {
    const result = await configApi.getPublicSocialAuthConfig({})
    if (result && result.code === CustomCode.OK && result.data) {
      return result.data as PublicSocialAuthConfigDto
    }
    throw toServiceError(result)
  }

  async getSocialAuthConfig(): Promise<SocialAuthConfigDto> {
    const result = await configApi.getSocialAuthConfig({})
    if (result && result.code === CustomCode.OK && result.data) {
      return result.data as SocialAuthConfigDto
    }
    throw toServiceError(result)
  }

  async setSocialAuthConfig(config: SetSocialAuthConfigDto) {
    const result = await configApi.setSocialAuthConfig({ body: config })
    if (result && result.code === CustomCode.OK) {
      return true
    }
    throw toServiceError(result)
  }
}

export const configService = ConfigService.getInstance()
