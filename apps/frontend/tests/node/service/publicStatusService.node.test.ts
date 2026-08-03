import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CustomCode } from '@/constant/custom-code'

const { requestMock } = vi.hoisted(() => ({
  requestMock: {
    get: vi.fn(),
  },
}))

vi.mock('@/stores/request', () => ({
  useRequestStore: () => ({
    getAxios: () => requestMock,
  }),
}))

import { publicStatusService } from '@/service/publicStatusService'

describe('publicStatusService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('unwraps the public status page payload', async () => {
    requestMock.get.mockResolvedValueOnce({
      code: CustomCode.OK,
      data: {
        name: 'Service status',
        slug: 'service-status',
        statusMonitors: [],
      },
    })

    await expect(publicStatusService.getStatus('service-status')).resolves.toEqual({
      name: 'Service status',
      slug: 'service-status',
      statusMonitors: [],
    })

    expect(requestMock.get).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'DeveloperStatusPublicControllerStatus' }),
      { path: { slug: 'service-status' } },
      undefined,
    )
  })
})
