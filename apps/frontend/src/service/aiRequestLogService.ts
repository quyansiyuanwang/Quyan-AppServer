import {
  createAiRequestLogControllerApi,
  AiRequestLogControllerList,
  AiRequestLogControllerContent,
  AiRequestLogControllerSearch,
  AiRequestLogControllerAttempts,
} from '@/client/services/ai-request-log-controller.gen'
import { useRequestStore } from '@/stores/request'
import { cacheObject } from '@/utils/common'
const api = cacheObject(() => createAiRequestLogControllerApi(useRequestStore().getAxios()))
const options = (signal?: AbortSignal) => ({
  signal,
  errorPresentation: 'local' as const,
  retry: false,
})
export type AIRequestLogFilters = (typeof AiRequestLogControllerList)['query']
export type AIRequestLogContentParams = (typeof AiRequestLogControllerContent)['query']
export const aiRequestLogService = {
  list: async (params: AIRequestLogFilters, signal?: AbortSignal) =>
    (await api.list({ params }, options(signal))).data,
  metadata: async (id: string, signal?: AbortSignal) =>
    (await api.metadata({ path: { id } }, options(signal))).data,
  content: async (id: string, params: AIRequestLogContentParams, signal?: AbortSignal) =>
    (await api.content({ path: { id }, params }, options(signal))).data,
  search: async (
    id: string,
    params: (typeof AiRequestLogControllerSearch)['query'],
    signal?: AbortSignal,
  ) => (await api.search({ path: { id }, params }, options(signal))).data,
  attempts: async (
    id: string,
    params: (typeof AiRequestLogControllerAttempts)['query'],
    signal?: AbortSignal,
  ) => (await api.attempts({ path: { id }, params }, options(signal))).data,
  detail: async (id: string) => (await api.detail({ path: { id } })).data,
}
