import { CustomCode } from '@/constant/custom-code'
import { useRequestStore } from '@/stores/request'
import { toServiceError } from '@/utils/error-utils'
import type { SendTwoFactorEmailCodeResponse, VerifyTwoFactorLoginResult } from './types'
import { cacheObject } from '@/utils/common'
import { createAuthControllerApi } from '@/client/services/auth-controller.gen'

const authApi = cacheObject(() => createAuthControllerApi(useRequestStore().getAxios()))

export class TwoFactorAuthService {
  private static instance: TwoFactorAuthService | null = null

  private constructor() {}

  static getInstance() {
    if (!this.instance) {
      this.instance = new TwoFactorAuthService()
    }
    return this.instance
  }

  async verifyLoginChallenge(params: {
    challengeToken: string
    code?: string
    recoveryCode?: string
    emailCode?: string
  }): Promise<VerifyTwoFactorLoginResult> {
    const result = await authApi.verifyTwoFactorLogin({
      body: {
        challengeToken: params.challengeToken,
        code: params.code,
        recoveryCode: params.recoveryCode,
        emailCode: params.emailCode,
      },
    })

    if (result && result.code === CustomCode.OK && result.data) {
      return result.data as VerifyTwoFactorLoginResult
    }

    if (result && result.code === CustomCode.POLICY_CONSENT_REQUIRED && result.data) {
      return result.data as VerifyTwoFactorLoginResult
    }

    throw toServiceError(result)
  }

  async sendLoginEmailCode(challengeToken: string): Promise<SendTwoFactorEmailCodeResponse> {
    const result = await authApi.sendTwoFactorEmailCode({
      body: {
        challengeToken,
      },
    })

    if (result && result.code === CustomCode.OK && result.data) {
      return result.data as SendTwoFactorEmailCodeResponse
    }

    throw toServiceError(result)
  }
}

export const twoFactorAuthService = TwoFactorAuthService.getInstance()
