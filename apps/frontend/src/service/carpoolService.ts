import { createCarpoolControllerApi } from '@/client/services/carpool-controller.gen'
import { useRequestStore } from '@/stores/request'
import { cacheObject } from '@/utils/common'
import type {
  AllocateCarpoolRatiosRequest,
  CreateCarpoolOrderRequest,
  CreateCarpoolPackageTemplateRequest,
  FailCarpoolOrderRequest,
  FulfillCarpoolOrderRequest,
  UpdateCarpoolPackageTemplateRequest,
} from '@/client/types.gen'

const api = cacheObject(() => createCarpoolControllerApi(useRequestStore().getAxios()))

export const carpoolService = {
  // Compatibility endpoint for older callers. New UI must use catalog().
  published: () => api.listPublishedPackages(),
  catalog: (page = 1, pageSize = 12, keyword?: string) =>
    api.listPackageCatalog({ params: { page, pageSize, keyword } }),
  mine: (page = 1, pageSize = 12, state?: string, keyword?: string) =>
    api.listMine({ params: { page, pageSize, state, keyword } }),
  detail: (id: string) => api.getOrder({ path: { id } }),
  create: (body: CreateCarpoolOrderRequest) => api.createOrder({ body }),
  invite: (id: string, validityHours = 24) =>
    api.createInvite({ path: { id }, body: { validityHours } }),
  acceptInvite: (token: string) => api.acceptInvite({ body: { token } }),
  allocate: (id: string, body: AllocateCarpoolRatiosRequest) =>
    api.allocateRatios({ path: { id }, body }),
  confirm: (id: string) => api.confirm({ path: { id } }),
  leave: (id: string) => api.leave({ path: { id } }),
  cancel: (id: string) => api.cancel({ path: { id } }),
  submit: (id: string) => api.submit({ path: { id } }),

  packages: (page = 1, pageSize = 20, keyword?: string, publishStatus?: string) =>
    api.listPackages({ params: { page, pageSize, keyword, publishStatus } }),
  createPackage: (body: CreateCarpoolPackageTemplateRequest) => api.createPackage({ body }),
  updatePackage: (id: string, body: UpdateCarpoolPackageTemplateRequest) =>
    api.updatePackage({ path: { id }, body }),
  duplicatePackage: (id: string) => api.duplicatePackage({ path: { id } }),
  archivePackage: (id: string) => api.archivePackage({ path: { id } }),
  publishPackage: (id: string) => api.publishPackage({ path: { id } }),
  unpublishPackage: (id: string) => api.unpublishPackage({ path: { id } }),

  admin: (page = 1, pageSize = 20, state?: string, keyword?: string) =>
    api.listAdmin({ params: { page, pageSize, state, keyword } }),
  adminDetail: (id: string) => api.getAdminOrder({ path: { id } }),
  deliveryChannels: (page = 1, pageSize = 10, keyword?: string, orderId?: string) =>
    api.listDeliveryChannels({ params: { page, pageSize, keyword, orderId } }),
  accept: (id: string) => api.accept({ path: { id } }),
  fulfill: (id: string, body: FulfillCarpoolOrderRequest) => api.fulfill({ path: { id }, body }),
  fail: (id: string, body: FailCarpoolOrderRequest) => api.fail({ path: { id }, body }),
}
