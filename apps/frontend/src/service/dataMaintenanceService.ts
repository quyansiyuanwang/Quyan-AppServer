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

const isGzip = (body: Uint8Array) => body[0] === 0x1f && body[1] === 0x8b

const unwrapResponseData = <T>(response: { data?: T; message?: unknown }): T => {
  if (response.data !== undefined) return response.data
  throw new Error(
    typeof response.message === 'string' ? response.message : 'Maintenance request failed',
  )
}

const prepareGzipArchive = async (file: File): Promise<Uint8Array> => {
  const body = new Uint8Array(await file.arrayBuffer())
  if (isGzip(body)) return body

  // Older archive downloads were served with Content-Encoding: gzip. Browsers
  // transparently decompress those downloads but retain their .ndjson.gz name.
  if (typeof CompressionStream === 'undefined') {
    throw new Error('This browser cannot recompress a downloaded archive. Use a current browser.')
  }

  const compressed = new Blob([body]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(compressed).arrayBuffer())
}

export const dataMaintenanceService = {
  optimizePreview: async (datasets: string[]) => {
    const captchaToken = await getCaptchaToken('data_maintenance_optimize_preview')
    return unwrapResponseData(
      await maintenanceApi.optimizePreview({
        body: { datasets, captchaToken },
      }),
    )
  },
  optimize: async (datasets: string[]) => {
    const captchaToken = await getCaptchaToken('data_maintenance_optimize')
    return unwrapResponseData(
      await maintenanceApi.optimize({
        body: { datasets, confirmation: 'OPTIMIZE', captchaToken },
      }),
    )
  },
  importPreview: async (dataset: string, file: File) => {
    const body = await prepareGzipArchive(file)
    return unwrapResponseData(
      await (maintenanceApi.importPreview as any)(
        { path: { dataset }, body },
        {
          customHeaders: await captchaHeaders('data_maintenance_import_preview', {
            'Content-Type': 'application/gzip',
          }),
        },
      ),
    )
  },
  createImport: async (dataset: string, file: File) => {
    const body = await prepareGzipArchive(file)
    return unwrapResponseData(
      await (maintenanceApi.createImport as any)(
        { path: { dataset }, body },
        {
          customHeaders: await captchaHeaders('data_maintenance_import', {
            'Content-Type': 'application/gzip',
            'X-Maintenance-Confirmation': 'IMPORT',
            'X-Archive-Filename': file.name,
          }),
        },
      ),
    )
  },
  listRuns: async (params: Record<string, unknown>) =>
    unwrapResponseData(await maintenanceApi.listRuns({ params: params as any })),
  getRun: async (runId: string) =>
    unwrapResponseData(await maintenanceApi.getRun({ path: { runId } })),
}
