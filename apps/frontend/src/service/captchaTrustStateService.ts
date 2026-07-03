import { CustomCode } from '@/constant/custom-code'
import { useRequestStore } from '@/stores/request'
import { cache } from '@/utils/common'
import { toServiceError } from '@/utils/error-utils'
import { createAuthControllerApi } from '@/client/services/auth-controller.gen'

const getAuthControllerApi = cache(() => createAuthControllerApi(useRequestStore().getAxios()))

export class CaptchaTrustStateService {
  private static instance: CaptchaTrustStateService | null = null

  static getInstance() {
    if (!this.instance) {
      this.instance = new CaptchaTrustStateService()
    }
    return this.instance
  }

  async getTrustStatus(): Promise<{ trusted: boolean; expiresInSeconds: number }> {
    const result = await getAuthControllerApi().getCaptchaTrustStatus({})

    if (result && result.code === CustomCode.OK && result.data) {
      return result.data as { trusted: boolean; expiresInSeconds: number }
    }

    throw toServiceError(result, 'Failed to get captcha trust status')
  }
}

export const captchaTrustStateService = CaptchaTrustStateService.getInstance()
