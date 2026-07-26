import { useRequestStore } from '@/stores/request'
import { checkApiResult } from '@/utils/service-utils'
import { cache } from '@/utils/common'
import type {
  CreateDeveloperApiKeyDto,
  CreateDeveloperProjectDto,
  CreateDeveloperPushChannelDto,
  CreateShortLinkDto,
  CreateDeveloperStatusMonitorDto,
  DeveloperQuotaSummaryDto,
  DeveloperShortLinkStatsDto,
  SetKvValueDto,
  UpdateDeveloperStatusMonitorDto,
  UpdateDeveloperPushChannelDto,
  UpdateShortLinkDto,
  UpsertDeveloperSecretDto,
} from '@/client/types.gen'
import { createDeveloperProjectControllerApi } from '@/client/services/developer-project-controller.gen'

const getDeveloperProjectApi = cache(() =>
  createDeveloperProjectControllerApi(useRequestStore().getAxios()),
)

export class DeveloperProjectService {
  private static instance: DeveloperProjectService

  static getInstance() {
    if (!this.instance) this.instance = new DeveloperProjectService()
    return this.instance
  }

  private unwrap<T>(response: { data?: T }): T {
    return (checkApiResult(response, true) as { data: T }).data
  }

  async listProjects() {
    return this.unwrap(await getDeveloperProjectApi().list({}))
  }

  async createProject(data: CreateDeveloperProjectDto) {
    return this.unwrap(await getDeveloperProjectApi().create({ body: data }))
  }

  async getUsageSummary(projectId: string) {
    return this.unwrap<DeveloperQuotaSummaryDto>(
      await getDeveloperProjectApi().getUsageSummary({ path: { projectId } }),
    )
  }

  async updateStatusPage(projectId: string, published: boolean) {
    return this.unwrap(
      await getDeveloperProjectApi().updateStatusPage({ path: { projectId }, body: { published } }),
    )
  }

  async listKeys(projectId: string) {
    return this.unwrap(await getDeveloperProjectApi().listKeys({ path: { projectId } }))
  }

  async createKey(projectId: string, data: CreateDeveloperApiKeyDto) {
    return this.unwrap(
      await getDeveloperProjectApi().createKey({ path: { projectId }, body: data }),
    )
  }

  async revokeKey(projectId: string, id: string) {
    return checkApiResult(
      await getDeveloperProjectApi().revokeKey({ path: { projectId, id } }),
      false,
    )
  }

  async listKv(projectId: string) {
    return this.unwrap(await getDeveloperProjectApi().listKv({ path: { projectId } }))
  }

  async getKv(projectId: string, key: string) {
    return this.unwrap(await getDeveloperProjectApi().getKv({ path: { projectId, key } }))
  }

  async setKv(projectId: string, key: string, data: SetKvValueDto) {
    return this.unwrap(
      await getDeveloperProjectApi().setKv({ path: { projectId, key }, body: data }),
    )
  }

  async deleteKv(projectId: string, key: string) {
    return checkApiResult(
      await getDeveloperProjectApi().deleteKv({ path: { projectId, key } }),
      false,
    )
  }

  async listShortLinks(projectId: string) {
    return this.unwrap(await getDeveloperProjectApi().listShortLinks({ path: { projectId } }))
  }

  async createShortLink(projectId: string, data: CreateShortLinkDto) {
    return this.unwrap(
      await getDeveloperProjectApi().createShortLink({ path: { projectId }, body: data }),
    )
  }

  async updateShortLink(projectId: string, id: string, data: UpdateShortLinkDto) {
    return this.unwrap(
      await getDeveloperProjectApi().updateShortLink({ path: { projectId, id }, body: data }),
    )
  }

  async deleteShortLink(projectId: string, id: string) {
    return checkApiResult(
      await getDeveloperProjectApi().deleteShortLink({ path: { projectId, id } }),
      false,
    )
  }

  async getShortLinkStats(projectId: string, id: string) {
    return this.unwrap<DeveloperShortLinkStatsDto>(
      await getDeveloperProjectApi().getShortLinkStats({ path: { projectId, id } }),
    )
  }

  async listSecrets(projectId: string) {
    return this.unwrap(await getDeveloperProjectApi().listSecrets({ path: { projectId } }))
  }

  async upsertSecret(projectId: string, data: UpsertDeveloperSecretDto) {
    return this.unwrap(
      await getDeveloperProjectApi().upsertSecret({ path: { projectId }, body: data }),
    )
  }

  async deleteSecret(projectId: string, alias: string) {
    return checkApiResult(
      await getDeveloperProjectApi().deleteSecret({ path: { projectId, alias } }),
      false,
    )
  }

  async listMonitors(projectId: string) {
    return this.unwrap(await getDeveloperProjectApi().listMonitors({ path: { projectId } }))
  }

  async createMonitor(projectId: string, data: CreateDeveloperStatusMonitorDto) {
    return this.unwrap(
      await getDeveloperProjectApi().createMonitor({ path: { projectId }, body: data }),
    )
  }

  async updateMonitor(projectId: string, id: string, data: UpdateDeveloperStatusMonitorDto) {
    return this.unwrap(
      await getDeveloperProjectApi().updateMonitor({ path: { projectId, id }, body: data }),
    )
  }

  async deleteMonitor(projectId: string, id: string) {
    return checkApiResult(
      await getDeveloperProjectApi().deleteMonitor({ path: { projectId, id } }),
      false,
    )
  }

  async listPushChannels(projectId: string) {
    return this.unwrap(await getDeveloperProjectApi().listPushChannels({ path: { projectId } }))
  }

  async listPushDeliveries(projectId: string) {
    return this.unwrap(await getDeveloperProjectApi().listPushDeliveries({ path: { projectId } }))
  }

  async createPushChannel(projectId: string, data: CreateDeveloperPushChannelDto) {
    return this.unwrap(
      await getDeveloperProjectApi().createPushChannel({ path: { projectId }, body: data }),
    )
  }

  async updatePushChannel(projectId: string, id: string, data: UpdateDeveloperPushChannelDto) {
    return this.unwrap(
      await getDeveloperProjectApi().updatePushChannel({ path: { projectId, id }, body: data }),
    )
  }

  async deletePushChannel(projectId: string, id: string) {
    return checkApiResult(
      await getDeveloperProjectApi().deletePushChannel({ path: { projectId, id } }),
      false,
    )
  }

  async checkMonitor(projectId: string, id: string) {
    return this.unwrap(await getDeveloperProjectApi().checkMonitor({ path: { projectId, id } }))
  }
}

export const developerProjectService = DeveloperProjectService.getInstance()
