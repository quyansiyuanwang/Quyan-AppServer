import { createAiRequestLogControllerApi } from '@/client/services/ai-request-log-controller.gen'
import { useRequestStore } from '@/stores/request'
import { cacheObject } from '@/utils/common'

const aiRequestLogApi = cacheObject(() =>
  createAiRequestLogControllerApi(useRequestStore().getAxios()),
)

export const aiRequestLogService = {
  list: async (params: Record<string, unknown>) =>
    (await aiRequestLogApi.list({ params: params as any })).data,
  detail: async (id: string) => (await aiRequestLogApi.detail({ path: { id } })).data,
}
