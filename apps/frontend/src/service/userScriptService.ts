import { useRequestStore } from '@/stores/request'
import { CustomCode } from '@/constant/custom-code'
import { cache } from '@/utils/common'
import { toServiceError } from '@/utils/error-utils'
import { createUserScriptControllerApi } from '@/client/services/user-script-controller.gen'

const getUserScriptControllerApi = cache(() =>
  createUserScriptControllerApi(useRequestStore().getAxios()),
)

interface CreateUserScriptRequest {
  name: string
  description?: string
  content: string
}

interface UpdateUserScriptRequest {
  name?: string
  description?: string
  content?: string
}

export class UserScriptService {
  private static instance: UserScriptService | null = null

  private constructor() {}

  static getInstance() {
    if (!this.instance) {
      this.instance = new UserScriptService()
    }
    return this.instance
  }

  async getScripts() {
    const result = await getUserScriptControllerApi().listScripts({})
    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }
    throw toServiceError(result)
  }

  async createScript(data: CreateUserScriptRequest) {
    const result = await getUserScriptControllerApi().createScript({
      body: data,
    })
    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }
    throw toServiceError(result)
  }

  async updateScript(id: string, data: UpdateUserScriptRequest) {
    const result = await getUserScriptControllerApi().updateScript({
      path: { id },
      body: data,
    })
    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }
    throw toServiceError(result)
  }

  async deleteScript(id: string) {
    const result = await getUserScriptControllerApi().deleteScript({
      path: { id },
    })
    if (result && result.code === CustomCode.OK) {
      return true
    }
    throw toServiceError(result)
  }
}

export const userScriptService = UserScriptService.getInstance()
