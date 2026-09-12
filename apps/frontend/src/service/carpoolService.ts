import { createCarpoolControllerApi } from '@/client/services/carpool-controller.gen'
import { useRequestStore } from '@/stores/request'
import { cacheObject } from '@/utils/common'
import type {
  AllocateCarpoolRatiosRequest,
  CreateCarpoolOrderRequest,
  CreateCarpoolPackageTemplateRequest,
  FulfillCarpoolOrderRequest,
} from '@/client/types.gen'
const api = cacheObject(() => createCarpoolControllerApi(useRequestStore().getAxios()))
export const carpoolService = {
  published: () => api.listPublishedPackages(),
  mine: (page = 1, pageSize = 20) => api.listMine({ params: { page, pageSize } }),
  detail: (id: string) => api.getOrder({ path: { id } }),
  create: (body: CreateCarpoolOrderRequest) => api.createOrder({ body }),
  invite: (id: string, validityHours = 72) =>
    api.createInvite({ path: { id }, body: { validityHours } }),
  acceptInvite: (token: string) => api.acceptInvite({ body: { token } }),
  allocate: (id: string, body: AllocateCarpoolRatiosRequest) =>
    api.allocateRatios({ path: { id }, body }),
  confirm: (id: string) => api.confirm({ path: { id } }),
  leave: (id: string) => api.leave({ path: { id } }),
  submit: (id: string) => api.submit({ path: { id } }),
  packages: (page = 1, pageSize = 20) => api.listPackages({ params: { page, pageSize } }),
  createPackage: (body: CreateCarpoolPackageTemplateRequest) => api.createPackage({ body }),
  publishPackage: (id: string) => api.publishPackage({ path: { id } }),
  unpublishPackage: (id: string) => api.unpublishPackage({ path: { id } }),
  admin: (page = 1, pageSize = 20) => api.listAdmin({ params: { page, pageSize } }),
  accept: (id: string) => api.accept({ path: { id } }),
  fulfill: (id: string, body: FulfillCarpoolOrderRequest) => api.fulfill({ path: { id }, body }),
  fail: (id: string) => api.fail({ path: { id } }),
}
