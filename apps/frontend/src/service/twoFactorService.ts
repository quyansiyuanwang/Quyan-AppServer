import { twoFactorAuthService } from '@/service/twoFactor/twoFactorAuthService'
import { twoFactorManagementService } from '@/service/twoFactor/twoFactorManagementService'
import { trustedDeviceService } from '@/service/twoFactor/trustedDeviceService'
import type { DisableTwoFactorOptions, ListTrustedDevicesOptions } from '@/service/twoFactor/types'

export class TwoFactorService {
  private static instance: TwoFactorService | null = null

  private constructor() {}

  static getInstance() {
    if (!this.instance) {
      this.instance = new TwoFactorService()
    }
    return this.instance
  }

  async getStatus() {
    return twoFactorManagementService.getStatus()
  }

  async beginSetup() {
    return twoFactorManagementService.beginSetup()
  }

  async confirmSetup(setupToken: string, code: string) {
    return twoFactorManagementService.confirmSetup(setupToken, code)
  }

  async disable(options: DisableTwoFactorOptions) {
    return twoFactorManagementService.disable(options)
  }

  async updatePasskeyPolicy(passkeyRequired: boolean) {
    return twoFactorManagementService.updatePasskeyPolicy(passkeyRequired)
  }

  async verifyLoginChallenge(params: {
    challengeToken: string
    code?: string
    recoveryCode?: string
    emailCode?: string
  }) {
    return twoFactorAuthService.verifyLoginChallenge(params)
  }

  async sendLoginEmailCode(challengeToken: string) {
    return twoFactorAuthService.sendLoginEmailCode(challengeToken)
  }

  async listTrustedDevices(options: ListTrustedDevicesOptions = {}) {
    return trustedDeviceService.listTrustedDevices(options)
  }

  async removeTrustedDevice(deviceId: string, signal?: AbortSignal) {
    return trustedDeviceService.removeTrustedDevice(deviceId, signal)
  }

  async clearTrustedWindow() {
    return twoFactorManagementService.clearTrustedWindow()
  }
}

export const twoFactorService = TwoFactorService.getInstance()

export { twoFactorAuthService, twoFactorManagementService, trustedDeviceService }
