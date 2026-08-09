import { createDataLifecycleControllerApi } from '@/client/services/data-lifecycle-controller.gen'
import { useRequestStore } from '@/stores/request'
import { cacheObject } from '@/utils/common'

const lifecycleApi = cacheObject(() =>
  createDataLifecycleControllerApi(useRequestStore().getAxios()),
)

export const dataLifecycleService = {
  listPolicies: async () => (await lifecycleApi.listPolicies()).data,
  getSchedule: async () => (await lifecycleApi.getSchedule()).data,
  updateSchedule: async (body: { enabled: boolean; time: string }) =>
    (await lifecycleApi.updateSchedule({ body })).data,
  preview: async (dataset: string) => (await lifecycleApi.preview({ path: { dataset } })).data,
  listCandidates: async (dataset: string, params: Record<string, unknown>) =>
    (await lifecycleApi.listCandidates({ path: { dataset }, params: params as any })).data,
  updatePolicy: async (dataset: string, body: { enabled: boolean; hotRetentionDays: number }) =>
    (await lifecycleApi.updatePolicy({ path: { dataset }, body })).data,
  run: async (dataset: string) => (await lifecycleApi.run({ path: { dataset } })).data,
  runBatch: async (datasets: string[]) =>
    (await lifecycleApi.runBatch({ body: { datasets } })).data,
  listRuns: async (params: Record<string, unknown>) =>
    (await lifecycleApi.listRuns({ params: params as any })).data,
  listArtifacts: async (runId: string, params: Record<string, unknown>) =>
    (await lifecycleApi.listArtifacts({ path: { runId }, params: params as any })).data,
  download: async (artifactId: string) =>
    (await lifecycleApi.download({ path: { artifactId } })).data,
}
