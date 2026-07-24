import type {
  CreateDeveloperProductApiKeyDto,
  CreateDeveloperProductInstanceDto,
  DeveloperProductCode,
  UpdateDeveloperPushChannelDto,
  UpdateDeveloperStatusMonitorDto,
  UpdateDeveloperStatusPageDto,
  UpdateShortLinkDto,
  UpdateDeveloperProductConfigDto,
  UpdateDeveloperProductAccountDto,
} from '@/client/types.gen'
import { createDeveloperProductAdminControllerApi } from '@/client/services/developer-product-admin-controller.gen'
import { createDeveloperProductSelfControllerApi } from '@/client/services/developer-product-self-controller.gen'
import { createDeveloperProductResourceControllerApi } from '@/client/services/developer-product-resource-controller.gen'
import { useRequestStore } from '@/stores/request'
import { cache } from '@/utils/common'
import { checkApiResult } from '@/utils/service-utils'
import { toServiceError } from '@/utils/error-utils'

const selfApi = cache(() => createDeveloperProductSelfControllerApi(useRequestStore().getAxios()))
const adminApi = cache(() => createDeveloperProductAdminControllerApi(useRequestStore().getAxios()))
const resourceApi = cache(() =>
  createDeveloperProductResourceControllerApi(useRequestStore().getAxios()),
)

export class DeveloperProductService {
  private static instance: DeveloperProductService

  static getInstance() {
    if (!this.instance) this.instance = new DeveloperProductService()
    return this.instance
  }

  private unwrap<T>(response: { data?: T }): T {
    return (checkApiResult(response, true) as { data: T }).data
  }

  async requestProductApi<T>(
    path: string,
    apiKey: string,
    method: 'GET' | 'POST',
    body?: unknown,
  ): Promise<T> {
    const baseUrl = import.meta.env.VITE_BACKEND_URL?.replace(/\/$/, '') || ''
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      credentials: 'omit',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey.trim()}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const payload: unknown = await response.json().catch(() => undefined)
    if (!response.ok)
      throw toServiceError(payload ?? new Error(`Request failed: ${response.status}`))
    return (checkApiResult(payload, true) as { data: T }).data
  }

  async catalog() {
    return this.unwrap(await selfApi().catalog({}))
  }

  async listInstances(product: DeveloperProductCode) {
    return this.unwrap(await selfApi().listInstances({ path: { product } }))
  }

  async getUsage(product: DeveloperProductCode) {
    return this.unwrap(await selfApi().getUsage({ path: { product } }))
  }

  async listCallLogs(product: DeveloperProductCode) {
    return this.unwrap(await selfApi().listCallLogs({ path: { product } }))
  }

  async listSubjects(product: DeveloperProductCode) {
    return this.unwrap(await selfApi().listSubjects({ path: { product } }))
  }

  async createInstance(product: DeveloperProductCode, body: CreateDeveloperProductInstanceDto) {
    return this.unwrap(await selfApi().createInstance({ path: { product }, body }))
  }

  async updateInstance(product: DeveloperProductCode, instanceId: string, enabled: boolean) {
    return this.unwrap(
      await selfApi().updateInstance({ path: { product, instanceId }, body: { enabled } }),
    )
  }

  async deleteInstance(product: DeveloperProductCode, instanceId: string) {
    return checkApiResult(await selfApi().deleteInstance({ path: { product, instanceId } }), false)
  }

  async listKeys(product: DeveloperProductCode, instanceId: string) {
    return this.unwrap(await selfApi().listKeys({ path: { product, instanceId } }))
  }

  async createKey(
    product: DeveloperProductCode,
    instanceId: string,
    body: CreateDeveloperProductApiKeyDto,
  ) {
    return this.unwrap(await selfApi().createKey({ path: { product, instanceId }, body }))
  }

  async revokeKey(product: DeveloperProductCode, instanceId: string, keyId: string) {
    return checkApiResult(
      await selfApi().revokeKey({ path: { product, instanceId, keyId } }),
      false,
    )
  }

  async listKvResources(instanceId: string) {
    return this.unwrap(await resourceApi().listKv({ path: { instanceId } }))
  }
  async getKvResource(instanceId: string, key: string) {
    return this.unwrap(await resourceApi().getKv({ path: { instanceId, key } }))
  }
  async setKvResource(
    instanceId: string,
    key: string,
    body: { value: unknown; ttlSeconds?: number },
  ) {
    return this.unwrap(await resourceApi().setKv({ path: { instanceId, key }, body }))
  }
  async deleteKvResource(instanceId: string, key: string) {
    return checkApiResult(await resourceApi().deleteKv({ path: { instanceId, key } }), false)
  }
  async listShortLinkResources(instanceId: string) {
    return this.unwrap(await resourceApi().listShortLinks({ path: { instanceId } }))
  }
  async createShortLinkResource(
    instanceId: string,
    body: { targetUrl: string; code?: string; expiresAt?: string },
  ) {
    return this.unwrap(await resourceApi().createShortLink({ path: { instanceId }, body }))
  }
  async updateShortLinkResource(instanceId: string, id: string, body: UpdateShortLinkDto) {
    return this.unwrap(await resourceApi().updateShortLink({ path: { instanceId, id }, body }))
  }
  async deleteShortLinkResource(instanceId: string, id: string) {
    return checkApiResult(await resourceApi().deleteShortLink({ path: { instanceId, id } }), false)
  }
  async shortLinkStats(instanceId: string, id: string, page = 1, pageSize = 25) {
    return this.unwrap(
      await resourceApi().shortLinkStats({ path: { instanceId, id }, params: { page, pageSize } }),
    )
  }
  async listSecretResources(instanceId: string) {
    return this.unwrap(await resourceApi().listSecrets({ path: { instanceId } }))
  }
  async upsertSecretResource(instanceId: string, body: { alias: string; value: string }) {
    return this.unwrap(await resourceApi().upsertSecret({ path: { instanceId }, body }))
  }
  async deleteSecretResource(instanceId: string, alias: string) {
    return checkApiResult(await resourceApi().deleteSecret({ path: { instanceId, alias } }), false)
  }
  async listMonitorResources(instanceId: string) {
    return this.unwrap(await resourceApi().listMonitors({ path: { instanceId } }))
  }
  async createMonitorResource(
    instanceId: string,
    body: {
      name: string
      targetUrl: string
      method?: 'GET' | 'HEAD'
      intervalSec?: number
      successStatusCodes?: number[]
    },
  ) {
    return this.unwrap(await resourceApi().createMonitor({ path: { instanceId }, body }))
  }
  async updateMonitorResource(
    instanceId: string,
    id: string,
    body: UpdateDeveloperStatusMonitorDto,
  ) {
    return this.unwrap(await resourceApi().updateMonitor({ path: { instanceId, id }, body }))
  }
  async deleteMonitorResource(instanceId: string, id: string) {
    return checkApiResult(await resourceApi().deleteMonitor({ path: { instanceId, id } }), false)
  }
  async checkMonitorResource(instanceId: string, id: string) {
    return this.unwrap(await resourceApi().checkMonitor({ path: { instanceId, id } }))
  }
  async updateStatusPageResource(instanceId: string, body: UpdateDeveloperStatusPageDto) {
    return this.unwrap(await resourceApi().updateStatusPage({ path: { instanceId }, body }))
  }
  async getStatusPageResource(instanceId: string) {
    return this.unwrap(await resourceApi().getStatusPage({ path: { instanceId } }))
  }
  async listPushChannelResources(instanceId: string) {
    return this.unwrap(await resourceApi().listPushChannels({ path: { instanceId } }))
  }
  async createPushChannelResource(
    instanceId: string,
    body: {
      name: string
      type: 'webhook' | 'dingtalk' | 'feishu' | 'wechat_work'
      endpoint: string
      secretAlias?: string
    },
  ) {
    return this.unwrap(await resourceApi().createPushChannel({ path: { instanceId }, body }))
  }
  async updatePushChannelResource(
    instanceId: string,
    id: string,
    body: UpdateDeveloperPushChannelDto,
  ) {
    return this.unwrap(await resourceApi().updatePushChannel({ path: { instanceId, id }, body }))
  }
  async deletePushChannelResource(instanceId: string, id: string) {
    return checkApiResult(
      await resourceApi().deletePushChannel({ path: { instanceId, id } }),
      false,
    )
  }
  async listPushDeliveryResources(instanceId: string) {
    return this.unwrap(await resourceApi().listPushDeliveries({ path: { instanceId } }))
  }

  async listConfigs() {
    return this.unwrap(await adminApi().listConfigs({}))
  }

  async updateConfig(product: DeveloperProductCode, body: UpdateDeveloperProductConfigDto) {
    return this.unwrap(await adminApi().updateConfig({ path: { product }, body }))
  }

  async listAccounts(product?: DeveloperProductCode) {
    if (product) return this.unwrap(await adminApi().listProductAccounts({ path: { product } }))
    return this.unwrap(await adminApi().listAccounts({}))
  }

  async listManagedAccounts(
    product: DeveloperProductCode,
    params: { page?: number; pageSize?: number; keyword?: string } = {},
  ) {
    return this.unwrap(await adminApi().listManagedAccounts({ path: { product }, params }))
  }

  async updateManagedAccount(
    product: DeveloperProductCode,
    userId: string,
    body: UpdateDeveloperProductAccountDto,
  ) {
    return this.unwrap(await adminApi().updateManagedAccount({ path: { product, userId }, body }))
  }

  async listManagedInstances(product: DeveloperProductCode, userId: string) {
    return this.unwrap(await adminApi().listManagedInstances({ path: { product, userId } }))
  }

  async getManagedUsage(product: DeveloperProductCode, userId: string) {
    return this.unwrap(await adminApi().getManagedUsage({ path: { product, userId } }))
  }

  async listManagedCallLogs(product: DeveloperProductCode, userId: string) {
    return this.unwrap(await adminApi().listManagedCallLogs({ path: { product, userId } }))
  }
}

export const developerProductService = DeveloperProductService.getInstance()
