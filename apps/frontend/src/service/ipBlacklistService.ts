import { useRequestStore } from '@/stores/request'
import { CustomCode } from '@/constant/custom-code'
import type { CreateIpBlacklistDto, UpdateIpBlacklistDto } from '@/client/types.gen'
import { toServiceError } from '@/utils/error-utils'
import { cacheObject } from '@/utils/common'
import { createIpBlacklistControllerApi } from '@/client/services/ip-blacklist-controller.gen'

const ipBlacklistApi = cacheObject(() =>
  createIpBlacklistControllerApi(useRequestStore().getAxios()),
)

export class IPBlacklistService {
  private static instance: IPBlacklistService | null = null

  private constructor() {}

  static getInstance() {
    if (!this.instance) {
      this.instance = new IPBlacklistService()
    }
    return this.instance
  }

  async getAll(limit?: number, offset?: number) {
    const result = await ipBlacklistApi.getAllIpBlacklists({
      params: { limit, offset },
    })
    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }
    throw toServiceError(result, 'Failed to get IP blacklists')
  }

  async getById(id: string) {
    const result = await ipBlacklistApi.getIpBlacklistById({
      path: { id },
    })
    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }
    throw toServiceError(result, 'Failed to get IP blacklist')
  }

  async create(data: CreateIpBlacklistDto) {
    const result = await ipBlacklistApi.createIpBlacklist({
      body: data,
    })
    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }
    throw toServiceError(result, 'Failed to create IP blacklist')
  }

  async update(ipAddress: string, data: UpdateIpBlacklistDto) {
    const result = await ipBlacklistApi.updateIpBlacklist({
      path: { ipAddress },
      body: data,
    })
    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }
    throw toServiceError(result, 'Failed to update IP blacklist')
  }

  async delete(ipAddress: string) {
    const result = await ipBlacklistApi.deleteIpBlacklist({
      path: { ipAddress },
    })

    if (result && result.code === CustomCode.OK) {
      return true
    }
    throw toServiceError(result, 'Failed to delete IP blacklist')
  }

  async checkIp(ip: string) {
    const result = await ipBlacklistApi.checkIpBlacklist({
      path: { ip },
    })
    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }
    throw toServiceError(result, 'Failed to check IP blacklist')
  }
}

export const ipBlacklistService = IPBlacklistService.getInstance()
