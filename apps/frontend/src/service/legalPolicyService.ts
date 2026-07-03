import { useRequestStore } from '@/stores/request'
import { CustomCode } from '@/constant/custom-code'
import { toServiceError } from '@/utils/error-utils'
import { ensureCaptchaTrust } from '@/service/captchaDialogService'
import type {
  CreateLegalPolicyDto,
  LegalPolicyDto,
  LegalPolicyListItemDto,
  LegalPolicyType,
  PublicLegalPolicyDto,
  UpdateLegalPolicyDto,
} from '@/client/types.gen'
import { cacheObject } from '@/utils/common'
import { createPublicLegalPolicyControllerApi } from '@/client/services/public-legal-policy-controller.gen'
import { createLegalPolicyControllerApi } from '@/client/services/legal-policy-controller.gen'

const legalPolicyApi = cacheObject(() =>
  createLegalPolicyControllerApi(useRequestStore().getAxios()),
)

const publicLegalPolicyApi = cacheObject(() =>
  createPublicLegalPolicyControllerApi(useRequestStore().getAxios()),
)

export class LegalPolicyService {
  private static instance: LegalPolicyService | null = null

  private constructor() {}

  static getInstance() {
    if (!this.instance) {
      this.instance = new LegalPolicyService()
    }
    return this.instance
  }

  async getCurrentPolicies(policyType?: LegalPolicyType): Promise<PublicLegalPolicyDto[]> {
    const execute = () =>
      publicLegalPolicyApi.getCurrentPolicies({
        body: {
          policyType,
        },
      })

    let result = await execute()

    if (result?.code === CustomCode.CAPTCHA_TRUST_REQUIRED) {
      await ensureCaptchaTrust('view_policy')
      result = await execute()
    }

    if (result && result.code === CustomCode.OK && result.data) {
      return result.data.policies ?? []
    }

    throw toServiceError(result, 'Failed to load legal policies')
  }

  async listPolicies(): Promise<LegalPolicyListItemDto[]> {
    const result = await legalPolicyApi.listPolicies({})

    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }

    throw toServiceError(result, 'Failed to load legal policy list')
  }

  async getPolicy(id: string): Promise<LegalPolicyDto> {
    const result = await legalPolicyApi.getPolicy({
      path: { id },
    })

    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }

    throw toServiceError(result, 'Failed to load legal policy details')
  }

  async createPolicy(data: CreateLegalPolicyDto): Promise<LegalPolicyDto> {
    const result = await legalPolicyApi.createPolicy({
      body: data,
    })

    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }

    throw toServiceError(result, 'Failed to create legal policy')
  }

  async updatePolicy(id: string, data: UpdateLegalPolicyDto): Promise<LegalPolicyDto> {
    const result = await legalPolicyApi.updatePolicy({
      path: { id },
      body: data,
    })

    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }

    throw toServiceError(result, 'Failed to update legal policy')
  }

  async deletePolicy(id: string): Promise<boolean> {
    const result = await legalPolicyApi.deletePolicy({
      path: { id },
    })

    if (result && result.code === CustomCode.OK) {
      return true
    }

    throw toServiceError(result, 'Failed to delete legal policy')
  }

  async publishPolicy(id: string): Promise<LegalPolicyDto> {
    const result = await legalPolicyApi.publishPolicy({
      path: { id },
    })

    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }

    throw toServiceError(result, 'Failed to publish legal policy')
  }

  async unpublishPolicy(id: string): Promise<LegalPolicyDto> {
    const result = await legalPolicyApi.unpublishPolicy({
      path: { id },
    })

    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }

    throw toServiceError(result, 'Failed to unpublish legal policy')
  }
}

export const legalPolicyService = LegalPolicyService.getInstance()
