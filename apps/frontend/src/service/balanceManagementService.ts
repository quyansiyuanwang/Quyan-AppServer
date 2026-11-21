import { createBalanceManagementControllerApi } from '@/client/services/balance-management-controller.gen'
import { cacheObject } from '@/utils/common'
import { useRequestStore } from '@/stores/request'
import type {
  AdjustBalanceAccountRequest,
  PreviewOverdraftRequest,
  SetDefaultOverdraftRequest,
  SetUserOverdraftRequest,
} from '@/client/types.gen'

const api = cacheObject(() => createBalanceManagementControllerApi(useRequestStore().getAxios()))
class BalanceManagementService {
  private static instance: BalanceManagementService
  static getInstance() {
    return (this.instance ??= new BalanceManagementService())
  }
  async list(params: { page: number; pageSize: number; userId?: string }) {
    return (await api.listManagedAccounts({ params })).data
  }
  async defaults() {
    return (await api.getOverdraftDefaults({})).data
  }
  async saveDefaults(body: SetDefaultOverdraftRequest) {
    return (await api.setOverdraftDefaults({ body })).data
  }
  async preview(body: PreviewOverdraftRequest) {
    return (await api.previewOverdraft({ body })).data
  }
  async saveUsers(body: SetUserOverdraftRequest) {
    return (await api.setUserOverdraft({ body })).data
  }
  async adjust(body: AdjustBalanceAccountRequest) {
    return (await api.adjustBalanceAccount({ body })).data
  }
  async previewAdjustment(body: AdjustBalanceAccountRequest) {
    return (await api.previewBalanceAccountAdjustment({ body })).data
  }
}
export const balanceManagementService = BalanceManagementService.getInstance()
