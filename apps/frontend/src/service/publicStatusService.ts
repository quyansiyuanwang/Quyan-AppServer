import { createDeveloperStatusPublicControllerApi } from '@/client/services/developer-status-public-controller.gen'
import { useRequestStore } from '@/stores/request'
import { cache } from '@/utils/common'
import { checkApiResult } from '@/utils/service-utils'

export interface PublicStatusCheck {
  checkStatus: string
  statusCode: number
  latencyMs: number
  checkedAt: string
}

export interface PublicStatusMonitor {
  name: string
  lastStatus: string
  lastCheckedAt: string
  availability: number
  checks: PublicStatusCheck[]
}

export interface PublicStatusPage {
  name: string
  slug: string
  statusMonitors: PublicStatusMonitor[]
}

const getPublicStatusApi = cache(() =>
  createDeveloperStatusPublicControllerApi(useRequestStore().getAxios()),
)

export class PublicStatusService {
  private static instance: PublicStatusService

  static getInstance() {
    if (!this.instance) this.instance = new PublicStatusService()
    return this.instance
  }

  async getStatus(slug: string): Promise<PublicStatusPage> {
    return checkApiResult<PublicStatusPage>(
      await getPublicStatusApi().status({ path: { slug } }),
      true,
    )
  }
}

export const publicStatusService = PublicStatusService.getInstance()
