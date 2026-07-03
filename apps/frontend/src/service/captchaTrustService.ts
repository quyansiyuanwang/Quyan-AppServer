import { CustomCode } from '@/constant/custom-code'
import { useRequestStore } from '@/stores/request'
import { cache } from '@/utils/common'
import { toServiceError } from '@/utils/error-utils'
import { createAuthControllerApi } from '@/client/services/auth-controller.gen'

const getAuthControllerApi = cache(() => createAuthControllerApi(useRequestStore().getAxios()))

export class CaptchaTrustService {
  private static instance: CaptchaTrustService | null = null

  static getInstance() {
    if (!this.instance) {
      this.instance = new CaptchaTrustService()
    }
    return this.instance
  }

  async verifyAndTrust(captchaToken: string, action: string, provider: 'recaptcha' | 'turnstile') {
    const result = await getAuthControllerApi().verifyCaptchaTrust({
      body: {
        captchaToken,
        action,
        provider,
      },
    })

    if (result && result.code === CustomCode.OK && result.data) {
      return result.data as { trusted: true; expiresInSeconds: number }
    }

    throw toServiceError(result, 'Failed to establish captcha trust')
  }
}

export const captchaTrustService = CaptchaTrustService.getInstance()
