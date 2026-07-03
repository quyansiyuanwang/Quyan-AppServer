import { beforeEach, describe, expect, it, vi } from 'vitest'

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

import systemService from '@/service/systemService'

const expectOperation = (name: string) => expect.objectContaining({ name })

describe('systemService.getConsumptionStats', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('omits empty filter arrays and forwards populated filters', async () => {
    requestMock.get.mockResolvedValue({
      code: 0,
      data: { summary: { totalSpend: 1 } },
    })

    const result = await systemService.getConsumptionStats({
      startDate: '2026-04-01T00:00:00.000Z',
      endDate: '2026-04-07T23:59:59.999Z',
      userIds: ['user-1', 'user-2'],
      models: [],
      channels: ['OpenAI'],
      relayTokenIds: [],
    })

    expect(requestMock.get).toHaveBeenCalledWith(
      expectOperation('SystemControllerGetConsumptionStats'),
      {
        params: {
          startDate: '2026-04-01T00:00:00.000Z',
          endDate: '2026-04-07T23:59:59.999Z',
          userIds: ['user-1', 'user-2'],
          models: undefined,
          channels: ['OpenAI'],
          relayTokenIds: undefined,
        },
      },
      { skipProgressBar: false },
    )
    expect(result).toEqual({ summary: { totalSpend: 1 } })
  })

  it('calls request بدون reqOpt when no filters are provided', async () => {
    requestMock.get.mockResolvedValue({
      code: 0,
      data: { summary: { totalSpend: 0 } },
    })

    await systemService.getConsumptionStats(undefined, true)

    expect(requestMock.get).toHaveBeenCalledWith(
      expectOperation('SystemControllerGetConsumptionStats'),
      undefined,
      { skipProgressBar: true },
    )
  })
})