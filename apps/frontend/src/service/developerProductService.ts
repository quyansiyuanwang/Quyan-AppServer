import type {
  CreateDeveloperProductApiKeyDto,
  CreateDeveloperProductInstanceDto,
  DeveloperProductCode,
  UpdateDeveloperProductConfigDto,
  UpsertDeveloperProductEntitlementDto,
} from '@/client/types.gen'
import { createDeveloperProductAdminControllerApi } from '@/client/services/developer-product-admin-controller.gen'
import { createDeveloperProductSelfControllerApi } from '@/client/services/developer-product-self-controller.gen'
import { createDeveloperProductResourceControllerApi } from '@/client/services/developer-product-resource-controller.gen'
import { useRequestStore } from '@/stores/request'
import { cache } from '@/utils/common'
import { checkApiResult } from '@/utils/service-utils'

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

  async catalog() {
    return this.unwrap(await selfApi().catalog({}))
  }

  async listOwnEntitlements() {
    return this.unwrap(await selfApi().listEntitlements({}))
  }

  async listInstances(product: DeveloperProductCode) {
    return this.unwrap(await selfApi().listInstances({ path: { product } }))
  }

  async listSubjects(product: DeveloperProductCode) {
    return this.unwrap(await selfApi().listSubjects({ path: { product } }))
  }

  async createInstance(product: DeveloperProductCode, body: CreateDeveloperProductInstanceDto) {
    return this.unwrap(await selfApi().createInstance({ path: { product }, body }))
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
  async listSecretResources(instanceId: string) {
    return this.unwrap(await resourceApi().listSecrets({ path: { instanceId } }))
  }
  async upsertSecretResource(instanceId: string, body: { alias: string; value: string }) {
    return this.unwrap(await resourceApi().upsertSecret({ path: { instanceId }, body }))
  }
  async listMonitorResources(instanceId: string) {
    return this.unwrap(await resourceApi().listMonitors({ path: { instanceId } }))
  }
  async listPushChannelResources(instanceId: string) {
    return this.unwrap(await resourceApi().listPushChannels({ path: { instanceId } }))
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

  async listEntitlements(product?: DeveloperProductCode) {
    if (product) return this.unwrap(await adminApi().listProductEntitlements({ path: { product } }))
    return this.unwrap(await adminApi().listEntitlements({}))
  }

  async upsertEntitlement(
    product: DeveloperProductCode,
    body: UpsertDeveloperProductEntitlementDto,
  ) {
    return this.unwrap(await adminApi().upsertEntitlement({ path: { product }, body }))
  }
}

export const developerProductService = DeveloperProductService.getInstance()
