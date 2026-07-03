import { useRequestStore } from '@/stores/request'
import type {
  AssignRemoteTerminalEntitlementRequest,
  ClaimRemoteTerminalProductTemplateRequest,
  CreateRemoteTerminalProductTemplateRequest,
  RemoteTerminalBoundDeviceListResponse,
  RemoteTerminalFilterOptionsDto,
  RemoteTerminalProductTemplateDto,
  RemoteTerminalProductTemplateListResponse,
  RemoteTerminalRegistrationTokenDto,
  RemoteTerminalUnbindReminderDto,
  RemoteTerminalUserEntitlementDto,
  RemoteTerminalUserEntitlementListResponse,
  RotateRemoteTerminalRegistrationTokenRequest,
  UpdateRemoteTerminalEntitlementRequest,
  UpdateRemoteTerminalProductTemplateRequest,
} from '@/client/types.gen'
import { cacheObject } from '@/utils/common'
import { createRemoteTerminalProductControllerApi } from '@/client/services/remote-terminal-product-controller.gen'

const remoteTerminalProductApi = cacheObject(() =>
  createRemoteTerminalProductControllerApi(useRequestStore().getAxios()),
)

class RemoteTerminalProductService {
  private static instance: RemoteTerminalProductService

  static getInstance() {
    if (!this.instance) {
      this.instance = new RemoteTerminalProductService()
    }

    return this.instance
  }

  async getFilterOptions(): Promise<RemoteTerminalFilterOptionsDto> {
    const result = await remoteTerminalProductApi.getFilterOptions({})
    return result.data
  }

  async listPublishedTemplates(): Promise<RemoteTerminalProductTemplateDto[]> {
    const result = await remoteTerminalProductApi.listPublishedTemplates({})
    return result.data
  }

  async listTemplates(params?: {
    page?: number
    pageSize?: number
    status?: number
    keyword?: string
  }): Promise<RemoteTerminalProductTemplateListResponse> {
    const result = await remoteTerminalProductApi.listTemplates({
      params: params || {},
    })
    return result.data
  }

  async createTemplate(
    data: CreateRemoteTerminalProductTemplateRequest,
  ): Promise<RemoteTerminalProductTemplateDto> {
    const result = await remoteTerminalProductApi.createTemplate({
      body: data,
    })
    return result.data
  }

  async updateTemplate(
    id: string,
    data: UpdateRemoteTerminalProductTemplateRequest,
  ): Promise<RemoteTerminalProductTemplateDto> {
    const result = await remoteTerminalProductApi.updateTemplate({
      path: { id },
      body: data,
    })
    return result.data
  }

  async publishTemplate(id: string): Promise<RemoteTerminalProductTemplateDto> {
    const result = await remoteTerminalProductApi.publishTemplate({
      path: { id },
    })
    return result.data
  }

  async unpublishTemplate(id: string): Promise<RemoteTerminalProductTemplateDto> {
    const result = await remoteTerminalProductApi.unpublishTemplate({
      path: { id },
    })
    return result.data
  }

  async deleteTemplate(id: string): Promise<void> {
    await remoteTerminalProductApi.deleteTemplate({
      path: { id },
    })
  }

  async listEntitlements(params?: {
    page?: number
    pageSize?: number
    userId?: string
    templateId?: string
    status?: number
  }): Promise<RemoteTerminalUserEntitlementListResponse> {
    const result = await remoteTerminalProductApi.listEntitlements({
      params: params || {},
    })
    return result.data
  }

  async listMyEntitlements(params?: {
    page?: number
    pageSize?: number
    status?: number
  }): Promise<RemoteTerminalUserEntitlementListResponse> {
    const result = await remoteTerminalProductApi.listCurrentUserEntitlements({
      params: params || {},
    })
    return result.data
  }

  async assignEntitlement(
    data: AssignRemoteTerminalEntitlementRequest,
  ): Promise<RemoteTerminalUserEntitlementDto> {
    const result = await remoteTerminalProductApi.assignEntitlement({
      body: data,
    })
    return result.data
  }

  async claimTemplate(
    data: ClaimRemoteTerminalProductTemplateRequest,
  ): Promise<RemoteTerminalUserEntitlementDto> {
    const result = await remoteTerminalProductApi.claimPublishedTemplate({
      body: data,
    })
    return result.data
  }

  async updateEntitlement(
    id: string,
    data: UpdateRemoteTerminalEntitlementRequest,
  ): Promise<RemoteTerminalUserEntitlementDto> {
    const result = await remoteTerminalProductApi.updateEntitlement({
      path: { id },
      body: data,
    })
    return result.data
  }

  async deleteEntitlement(id: string): Promise<void> {
    await remoteTerminalProductApi.deleteEntitlement({
      path: { id },
    })
  }

  async rotateRegistrationToken(
    id: string,
    data: RotateRemoteTerminalRegistrationTokenRequest,
  ): Promise<RemoteTerminalRegistrationTokenDto> {
    const result = await remoteTerminalProductApi.rotateRegistrationToken({
      path: { id },
      body: data,
    })
    return result.data
  }

  async rotateMyRegistrationToken(
    id: string,
    data: RotateRemoteTerminalRegistrationTokenRequest = {},
  ): Promise<RemoteTerminalRegistrationTokenDto> {
    const result = await remoteTerminalProductApi.rotateCurrentUserRegistrationToken({
      path: { id },
      body: data,
    })
    return result.data
  }

  async issueMyInstallToken(id: string): Promise<{ token: string; expiresAt: string }> {
    const result = await remoteTerminalProductApi.getMyInstallToken({ path: { id } })
    return result.data
  }

  async listDevices(params?: {
    page?: number
    pageSize?: number
    userId?: string
    entitlementId?: string
    status?: number
  }): Promise<RemoteTerminalBoundDeviceListResponse> {
    const result = await remoteTerminalProductApi.listDevices({
      params: params || {},
    })
    return result.data
  }

  async listMyDevices(params?: {
    page?: number
    pageSize?: number
    status?: number
  }): Promise<RemoteTerminalBoundDeviceListResponse> {
    const result = await remoteTerminalProductApi.listCurrentUserDevices({
      params: params || {},
    })
    return result.data
  }

  async getMyDeviceUnbindReminder(id: string): Promise<RemoteTerminalUnbindReminderDto> {
    const result = await remoteTerminalProductApi.getCurrentUserDeviceUnbindReminder({
      path: { id },
    })
    return result.data
  }

  async revokeDevice(id: string): Promise<void> {
    await remoteTerminalProductApi.revokeDevice({
      path: { id },
    })
  }

  async revokeMyDevice(id: string): Promise<void> {
    await remoteTerminalProductApi.revokeCurrentUserDevice({
      path: { id },
    })
  }

  async resetUnbindCount(entitlementId: string): Promise<void> {
    await remoteTerminalProductApi.resetUnbindCount({
      path: { id: entitlementId },
    })
  }
}

export const remoteTerminalProductService = RemoteTerminalProductService.getInstance()
