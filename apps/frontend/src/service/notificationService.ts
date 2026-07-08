import type {
  UpdateNotificationPreferenceDto,
  CreateNotificationWebhookDto,
  UpdateNotificationWebhookDto,
  MarkNotificationInboxReadDto,
} from '@/client/types.gen'
import { useRequestStore } from '@/stores/request'
import { checkApiResult } from '@/utils/service-utils'
import { cacheObject } from '@/utils/common'
import { createNotificationControllerApi } from '@/client/services/notification-controller.gen'

const notificationApi = cacheObject(() =>
  createNotificationControllerApi(useRequestStore().getAxios()),
)

export class NotificationService {
  private static instance: NotificationService

  static getInstance() {
    if (!this.instance) {
      this.instance = new NotificationService()
    }
    return this.instance
  }

  async getPreferences() {
    const result = await notificationApi.getPreferences({})
    return checkApiResult(result, true)
  }

  async updatePreferences(data: UpdateNotificationPreferenceDto) {
    const result = await notificationApi.updatePreferences({ body: data })
    return checkApiResult(result, true)
  }

  async listWebhooks() {
    const result = await notificationApi.listWebhooks({})
    return checkApiResult(result, true)
  }

  async createWebhook(data: CreateNotificationWebhookDto) {
    const result = await notificationApi.createWebhook({ body: data })
    return checkApiResult(result, true)
  }

  async updateWebhook(id: string, data: UpdateNotificationWebhookDto) {
    const result = await notificationApi.updateWebhook({
      path: { id },
      body: data,
    })
    return checkApiResult(result, true)
  }

  async deleteWebhook(id: string) {
    const result = await notificationApi.deleteWebhook({ path: { id } })
    return checkApiResult(result, false)
  }

  async testWebhook(id: string) {
    const result = await notificationApi.testWebhook({ path: { id } })
    return checkApiResult(result, true)
  }

  async testEmail() {
    const result = await notificationApi.testEmail({})
    return checkApiResult(result, true)
  }

  async getLogs(page = 1, pageSize = 20) {
    const result = await notificationApi.getLogs({
      params: { page, pageSize },
    })
    return checkApiResult(result, true)
  }

  async getInbox(page = 1, pageSize = 20, unreadOnly = false) {
    const result = await notificationApi.getInbox({
      params: { page, pageSize, unreadOnly },
    })
    return checkApiResult(result, true)
  }

  async markInboxRead(data: MarkNotificationInboxReadDto) {
    const result = await notificationApi.markInboxRead({ body: data })
    return checkApiResult(result, true)
  }

  async confirmPixelOpenedRead() {
    const result = await notificationApi.confirmPixelOpenedRead({})
    return checkApiResult(result, true)
  }

  async getEventList() {
    const result = await notificationApi.getEventList({})
    return checkApiResult(result, true)
  }
}
