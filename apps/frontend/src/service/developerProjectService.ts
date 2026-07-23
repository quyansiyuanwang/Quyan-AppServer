import { useRequestStore } from '@/stores/request'
import { checkApiResult } from '@/utils/service-utils'
import { cache } from '@/utils/common'
import type {
  CreateDeveloperApiKeyDto,
  CreateDeveloperProjectDto,
  CreateShortLinkDto,
  CreateDeveloperStatusMonitorDto,
  SetKvValueDto,
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

  async listProjects() {
    return checkApiResult(await getDeveloperProjectApi().list({}), true)
  }

  async createProject(data: CreateDeveloperProjectDto) {
    return checkApiResult(await getDeveloperProjectApi().create({ body: data }), true)
  }

  async listKeys(projectId: string) {
    return checkApiResult(await getDeveloperProjectApi().listKeys({ path: { projectId } }), true)
  }

  async createKey(projectId: string, data: CreateDeveloperApiKeyDto) {
    return checkApiResult(
      await getDeveloperProjectApi().createKey({ path: { projectId }, body: data }),
      true,
    )
  }

  async revokeKey(projectId: string, id: string) {
    return checkApiResult(
      await getDeveloperProjectApi().revokeKey({ path: { projectId, id } }),
      false,
    )
  }

  async listKv(projectId: string) {
    return checkApiResult(await getDeveloperProjectApi().listKv({ path: { projectId } }), true)
  }

  async getKv(projectId: string, key: string) {
    return checkApiResult(await getDeveloperProjectApi().getKv({ path: { projectId, key } }), true)
  }

  async setKv(projectId: string, key: string, data: SetKvValueDto) {
    return checkApiResult(
      await getDeveloperProjectApi().setKv({ path: { projectId, key }, body: data }),
      true,
    )
  }

  async deleteKv(projectId: string, key: string) {
    return checkApiResult(await getDeveloperProjectApi().deleteKv({ path: { projectId, key } }), false)
  }

  async listShortLinks(projectId: string) {
    return checkApiResult(
      await getDeveloperProjectApi().listShortLinks({ path: { projectId } }),
      true,
    )
  }

  async createShortLink(projectId: string, data: CreateShortLinkDto) {
    return checkApiResult(
      await getDeveloperProjectApi().createShortLink({ path: { projectId }, body: data }),
      true,
    )
  }

  async updateShortLink(projectId: string, id: string, data: UpdateShortLinkDto) {
    return checkApiResult(
      await getDeveloperProjectApi().updateShortLink({ path: { projectId, id }, body: data }),
      true,
    )
  }

  async deleteShortLink(projectId: string, id: string) {
    return checkApiResult(
      await getDeveloperProjectApi().deleteShortLink({ path: { projectId, id } }),
      false,
    )
  }

  async listSecrets(projectId: string) {
    return checkApiResult(await getDeveloperProjectApi().listSecrets({ path: { projectId } }), true)
  }

  async upsertSecret(projectId: string, data: UpsertDeveloperSecretDto) {
    return checkApiResult(
      await getDeveloperProjectApi().upsertSecret({ path: { projectId }, body: data }),
      true,
    )
  }

  async deleteSecret(projectId: string, alias: string) {
    return checkApiResult(
      await getDeveloperProjectApi().deleteSecret({ path: { projectId, alias } }),
      false,
    )
  }

  async listMonitors(projectId: string) {
    return checkApiResult(
      await getDeveloperProjectApi().listMonitors({ path: { projectId } }),
      true,
    )
  }

  async createMonitor(projectId: string, data: CreateDeveloperStatusMonitorDto) {
    return checkApiResult(
      await getDeveloperProjectApi().createMonitor({ path: { projectId }, body: data }),
      true,
    )
  }

  async checkMonitor(projectId: string, id: string) {
    return checkApiResult(
      await getDeveloperProjectApi().checkMonitor({ path: { projectId, id } }),
      true,
    )
  }
}

export const developerProjectService = DeveloperProjectService.getInstance()
