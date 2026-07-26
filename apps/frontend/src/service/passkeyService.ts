import { useRequestStore } from '@/stores/request'
import type { PasskeyCredentialItem, PolicyConsentRequiredData } from '@/client/types.gen'
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/browser'
import { toServiceError } from '@/utils/error-utils'
import { authorizationService } from '@/service/authorizationService'
import { cacheObject } from '@/utils/common'
import { createPasskeyControllerApi } from '@/client/services/passkey-controller.gen'

const passkeyApi = cacheObject(() => createPasskeyControllerApi(useRequestStore().getAxios()))

interface PasskeyTwoFactorChallenge {
  requiresTwoFactor: true
  challengeToken: string
  expiresIn: number
}

interface PasskeyAuthSuccessPayload {
  access_token: string
  refresh_token?: string
}

export class PasskeyService {
  private static instance: PasskeyService | null = null

  private constructor() {}

  static getInstance() {
    if (!this.instance) {
      this.instance = new PasskeyService()
    }
    return this.instance
  }

  async getRegistrationOptions() {
    const res = await passkeyApi.getRegistrationOptions({})
    return res.data.options
  }

  async verifyRegistration(response: RegistrationResponseJSON, name?: string) {
    return passkeyApi.verifyRegistration({
      body: { response: response as any, name },
    })
  }

  async getAuthOptions() {
    const res = await passkeyApi.getAuthOptions({})
    return res.data
  }

  isTwoFactorChallengePayload(data: unknown): data is PasskeyTwoFactorChallenge {
    return (
      !!data &&
      typeof data === 'object' &&
      'requiresTwoFactor' in data &&
      (data as { requiresTwoFactor?: unknown }).requiresTwoFactor === true &&
      'challengeToken' in data
    )
  }

  isAuthSuccessPayload(data: unknown): data is PasskeyAuthSuccessPayload {
    return !!data && typeof data === 'object' && 'access_token' in data
  }

  async verifyAuth(
    sessionId: string,
    response: AuthenticationResponseJSON,
  ): Promise<PasskeyTwoFactorChallenge | PasskeyAuthSuccessPayload | PolicyConsentRequiredData> {
    const res = await passkeyApi.verifyAuth({
      body: { response: response as any, sessionId, agreedToLegalPolicies: true },
    })

    const payload = res?.data

    if (this.isTwoFactorChallengePayload(payload)) {
      return payload
    }

    if (authorizationService.isPolicyConsentPayload(payload)) {
      return payload
    }

    if (!this.isAuthSuccessPayload(payload)) {
      throw toServiceError(res, 'Invalid passkey authentication response')
    }

    authorizationService.completeLogin(payload)

    return payload
  }

  async listCredentials(): Promise<PasskeyCredentialItem[]> {
    const res = await passkeyApi.listPasskeys({})
    return res.data.credentials ?? []
  }

  async deleteCredential(credentialId: string) {
    return passkeyApi.deletePasskey({ path: { credentialId } })
  }
}

export const passkeyService = PasskeyService.getInstance()
