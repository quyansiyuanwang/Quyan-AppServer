import { createDataMaintenanceControllerApi } from '@/client/services/data-maintenance-controller.gen'
import { useRequestStore } from '@/stores/request'
import { cacheObject } from '@/utils/common'
import { getCaptchaToken } from '@/utils/captcha'

const maintenanceApi = cacheObject(() =>
  createDataMaintenanceControllerApi(useRequestStore().getAxios()),
)

const captchaHeaders = async (action: string, extra: Record<string, string> = {}) => ({
  'X-Captcha-Token': await getCaptchaToken(action),
  ...extra,
})

export const dataMaintenanceService = {
  optimizePreview: async (datasets: string[]) => {
    const captchaToken = await getCaptchaToken('data_maintenance_optimize_preview')
    return (
      await maintenanceApi.optimizePreview({
        body: { datasets, captchaToken },
      })
    ).data
  },
  optimize: async (datasets: string[]) => {
    const captchaToken = await getCaptchaToken('data_maintenance_optimize')
    return (
      await maintenanceApi.optimize({
        body: { datasets, confirmation: 'OPTIMIZE', captchaToken },
      })
    ).data
  },
  importPreview: async (dataset: string, file: File) => {
    const body = new Uint8Array(await file.arrayBuffer())
    return (
      await (maintenanceApi.importPreview as any)(
        { path: { dataset }, body },
        {
          customHeaders: await captchaHeaders('data_maintenance_import_preview', {
            'Content-Type': 'application/gzip',
          }),
        },
      )
    ).data
  },
  createImport: async (dataset: string, file: File) => {
    const body = new Uint8Array(await file.arrayBuffer())
    return (
      await (maintenanceApi.createImport as any)(
        { path: { dataset }, body },
        {
          customHeaders: await captchaHeaders('data_maintenance_import', {
            'Content-Type': 'application/gzip',
            'X-Maintenance-Confirmation': 'IMPORT',
            'X-Archive-Filename': file.name,
          }),
        },
      )
    ).data
  },
  listRuns: async (params: Record<string, unknown>) =>
    (await maintenanceApi.listRuns({ params: params as any })).data,
  getRun: async (runId: string) =>
    (await maintenanceApi.getRun({ path: { runId } })).data,
}

