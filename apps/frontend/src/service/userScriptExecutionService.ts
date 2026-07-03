import { useRequestStore } from '@/stores/request'
import { CustomCode } from '@/constant/custom-code'
import { toServiceError } from '@/utils/error-utils'
import { cacheObject } from '@/utils/common'
import { createUserScriptExecutionControllerApi } from '@/client/services/user-script-execution-controller.gen'

const userScriptExecutionApi = cacheObject(() =>
  createUserScriptExecutionControllerApi(useRequestStore().getAxios()),
)

interface CreateExecutionRequest {
  scriptId?: string
  scriptName: string
  contentSnapshot: string
  output: string
  durationMs: number
}

class UserScriptExecutionService {
  private static instance: UserScriptExecutionService | null = null

  private constructor() {}

  static getInstance() {
    if (!this.instance) {
      this.instance = new UserScriptExecutionService()
    }
    return this.instance
  }

  async saveExecution(data: CreateExecutionRequest) {
    const result = await userScriptExecutionApi.saveExecution({
      body: data,
    })
    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }
    throw toServiceError(result)
  }

  async listExecutions() {
    const result = await userScriptExecutionApi.listExecutions({})
    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }
    throw toServiceError(result)
  }

  async listByScript(scriptId: string) {
    const result = await userScriptExecutionApi.listByScript({
      path: { scriptId },
    })
    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }
    throw toServiceError(result)
  }
}

export const userScriptExecutionService = UserScriptExecutionService.getInstance()
