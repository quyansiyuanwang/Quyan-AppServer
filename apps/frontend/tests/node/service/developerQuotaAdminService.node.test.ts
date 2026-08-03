import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CustomCode } from '@/constant/custom-code'

const { requestMock } = vi.hoisted(() => ({
  requestMock: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}))

vi.mock('@/stores/request', () => ({
  useRequestStore: () => ({
    getAxios: () => requestMock,
  }),
}))

import { DeveloperQuotaAdminService } from '@/service/developerQuotaAdminService'

const ok = <T>(data: T) => ({ code: CustomCode.OK, message: 'ok', data })
const operation = (name: string) => expect.objectContaining({ name })

describe('DeveloperQuotaAdminService', () => {
  let service: DeveloperQuotaAdminService

  beforeEach(() => {
    vi.clearAllMocks()
    ;(DeveloperQuotaAdminService as any).instance = undefined
    service = DeveloperQuotaAdminService.getInstance()
  })

  it('unwraps quota override collections for the management page', async () => {
    const overrides = [{ id: 'override-1', subjectId: 'project-1', dailyFreeQuota: 500 }]
    requestMock.get.mockResolvedValue(ok(overrides))

    await expect(service.list()).resolves.toEqual(overrides)
    expect(requestMock.get).toHaveBeenCalledWith(
      operation('DeveloperQuotaAdminControllerList'),
      {},
      undefined,
    )
  })

  it('passes updates through the replay-protected quota endpoint', async () => {
    const payload = { subjectType: 'project' as const, subjectId: 'project-1', dailyFreeQuota: 500 }
    requestMock.post.mockResolvedValue(ok({ id: 'override-1', ...payload }))

    await expect(service.upsert(payload)).resolves.toMatchObject(payload)
    expect(requestMock.post).toHaveBeenCalledWith(
      operation('DeveloperQuotaAdminControllerUpsert'),
      { body: payload },
      undefined,
    )
  })

  it('rejects API failures rather than treating them as successful management operations', async () => {
    requestMock.delete.mockResolvedValue({ code: 500, message: 'Failed' })

    await expect(service.remove('override-1')).rejects.toThrow()
  })
})
