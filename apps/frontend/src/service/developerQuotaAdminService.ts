import { useRequestStore } from '@/stores/request'
import { checkApiResult } from '@/utils/service-utils'
import { cache } from '@/utils/common'
import type { DeveloperQuotaOverrideDto, UpsertDeveloperQuotaOverrideDto } from '@/client/types.gen'
import { createDeveloperQuotaAdminControllerApi } from '@/client/services/developer-quota-admin-controller.gen'

const getDeveloperQuotaAdminApi = cache(() =>
  createDeveloperQuotaAdminControllerApi(useRequestStore().getAxios()),
)

export class DeveloperQuotaAdminService {
  private static instance: DeveloperQuotaAdminService

  static getInstance() {
    if (!this.instance) this.instance = new DeveloperQuotaAdminService()
    return this.instance
  }

  private unwrap<T>(response: { data?: T }): T {
    return (checkApiResult(response, true) as { data: T }).data
  }

  async list(): Promise<DeveloperQuotaOverrideDto[]> {
    return this.unwrap(await getDeveloperQuotaAdminApi().list({}))
  }

  async upsert(data: UpsertDeveloperQuotaOverrideDto): Promise<DeveloperQuotaOverrideDto> {
    return this.unwrap(await getDeveloperQuotaAdminApi().upsert({ body: data }))
  }

  async remove(id: string): Promise<void> {
    checkApiResult(await getDeveloperQuotaAdminApi().remove({ path: { id } }), false)
  }
}

export const developerQuotaAdminService = DeveloperQuotaAdminService.getInstance()
