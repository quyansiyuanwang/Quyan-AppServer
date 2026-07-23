import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CustomCode } from '@/constant/custom-code'

const { requestMock } = vi.hoisted(() => ({
  requestMock: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}))

vi.mock('@/stores/request', () => ({
  useRequestStore: () => ({
    getAxios: () => requestMock,
  }),
}))

import { DeveloperProjectService } from '@/service/developerProjectService'

const ok = <T>(data: T) => ({ code: CustomCode.OK, message: 'ok', data })
const operation = (name: string) => expect.objectContaining({ name })

describe('DeveloperProjectService', () => {
  let service: DeveloperProjectService

  beforeEach(() => {
    vi.clearAllMocks()
    ;(DeveloperProjectService as any).instance = undefined
    service = DeveloperProjectService.getInstance()
  })

  it('unwraps the project list response for the workspace view', async () => {
    const projects = [{ id: 'project-1', name: 'Console' }]
    requestMock.get.mockResolvedValue(ok(projects))

    await expect(service.listProjects()).resolves.toEqual(projects)
    expect(requestMock.get).toHaveBeenCalledWith(
      operation('DeveloperProjectControllerList'),
      {},
      undefined,
    )
  })

  it('unwraps management responses before callers update their local state', async () => {
    const project = { id: 'project-1', name: 'Console', slug: 'console' }
    requestMock.post.mockResolvedValue(ok(project))

    await expect(service.createProject({ name: 'Console', slug: 'console' })).resolves.toEqual(project)
    expect(requestMock.post).toHaveBeenCalledWith(
      operation('DeveloperProjectControllerCreate'),
      { body: { name: 'Console', slug: 'console' } },
      undefined,
    )
  })

  it('unwraps resource collections and the quota summary', async () => {
    const entries = [{ key: 'app.config', version: 1 }]
    requestMock.get.mockResolvedValueOnce(ok(entries)).mockResolvedValueOnce(
      ok({ dailyFreeQuota: 100, overageEnabled: false, usages: [] }),
    )

    await expect(service.listKv('project-1')).resolves.toEqual(entries)
    await expect(service.getUsageSummary('project-1')).resolves.toEqual({
      dailyFreeQuota: 100,
      overageEnabled: false,
      usages: [],
    })
  })

  it('keeps API failures as rejected promises instead of rendering response envelopes', async () => {
    requestMock.get.mockResolvedValue({ code: 500, message: 'Failed' })

    await expect(service.listProjects()).rejects.toThrow()
  })
})
