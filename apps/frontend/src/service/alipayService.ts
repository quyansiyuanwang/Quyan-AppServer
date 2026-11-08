import { createAlipayPaymentControllerApi } from '@/client/services/alipay-payment-controller.gen'
import type {
  CreateAlipayOrderDto,
  CreateAlipayRefundDto,
  SetAlipayConfigDto,
} from '@/client/types.gen'
import { useRequestStore } from '@/stores/request'
import { cacheObject } from '@/utils/common'

const api = cacheObject(() => createAlipayPaymentControllerApi(useRequestStore().getAxios()))
class AlipayService {
  private static instance: AlipayService
  static getInstance() {
    return (this.instance ??= new AlipayService())
  }
  async config() {
    return (await api.getConfig()).data
  }
  async publicConfig() {
    return (await api.getPublicConfig()).data
  }
  async saveConfig(body: SetAlipayConfigDto) {
    return (await api.setConfig({ body })).data
  }
  async create(body: CreateAlipayOrderDto) {
    return (await api.createOrder({ body })).data
  }
  async order(id: string) {
    return (await api.getOrder({ path: { id } })).data
  }
  async refresh(id: string) {
    return (await api.refreshOrder({ path: { id } })).data
  }
  async list(page: number, pageSize: number, management = false, userId?: string) {
    return management
      ? (await api.listManagedOrders({ params: { page, pageSize, userId } })).data
      : (await api.listOrders({ params: { page, pageSize } })).data
  }
  async refund(id: string, body: CreateAlipayRefundDto) {
    return (await api.refundOrder({ path: { id }, body })).data
  }
  async refreshRefund(id: string) {
    return (await api.refreshRefund({ path: { id } })).data
  }
  async refunds(id: string, page: number, pageSize: number, management = false) {
    return management
      ? (await api.listManagedRefunds({ path: { id }, params: { page, pageSize } })).data
      : (await api.listRefunds({ path: { id }, params: { page, pageSize } })).data
  }
}
export const alipayService = AlipayService.getInstance()
