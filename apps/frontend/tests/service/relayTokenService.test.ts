import { beforeEach, describe, expect, it, vi } from 'vitest'

const { requestMock } = vi.hoisted(() => ({
  requestMock: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}))

vi.mock('@/stores/request', () => ({
  useRequestStore: () => ({
    getAxios: () => requestMock,
  }),
}))

import { relayTokenService } from '@/service/relayTokenService'

const expectOperation = (name: string) => expect.objectContaining({ name })

describe('relayTokenService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the same singleton instance from constructor getInstance', () => {
    const serviceConstructor = (relayTokenService as any).constructor

    const sameInstance = serviceConstructor.getInstance()

    expect(sameInstance).toBe(relayTokenService)
  })

  it('creates relay token and returns data', async () => {
    requestMock.post.mockResolvedValue({ data: { id: 'tk-1' } })

    const result = await relayTokenService.createRelayToken({ name: 'token' } as any)

    expect(requestMock.post).toHaveBeenCalledWith(
      expectOperation('RelayControllerCreateToken'),
      {
        body: { name: 'token' },
      },
      undefined,
    )
    expect(result).toEqual({ id: 'tk-1' })
  })

  it('updates token channel with path and body', async () => {
    requestMock.put.mockResolvedValue({ data: { id: 'tk-1', channelId: 'ch-1' } })

    const result = await relayTokenService.updateTokenChannel('tk-1', 'ch-1')

    expect(requestMock.put).toHaveBeenCalledWith(
      expectOperation('RelayControllerUpdateTokenChannel'),
      {
        path: { id: 'tk-1' },
        body: { channelId: 'ch-1' },
      },
      undefined,
    )
    expect(result).toEqual({ id: 'tk-1', channelId: 'ch-1' })
  })

  it('requests usage with query date params', async () => {
    requestMock.get.mockResolvedValue({ data: { list: [] } })

    const result = await relayTokenService.getRelayTokenUsage('tk-1', '2026-01-01', '2026-01-31')

    expect(requestMock.get).toHaveBeenCalledWith(
      expectOperation('RelayControllerGetUsage'),
      {
        path: { id: 'tk-1' },
        params: { startDate: '2026-01-01', endDate: '2026-01-31' },
      },
      undefined,
    )
    expect(result).toEqual({ list: [] })
  })

  it('deletes relay token with path id', async () => {
    requestMock.delete.mockResolvedValue({})

    await relayTokenService.deleteRelayToken('tk-2')

    expect(requestMock.delete).toHaveBeenCalledWith(
      expectOperation('RelayControllerDeleteToken'),
      {
        params: { targetUserId: undefined },
        path: { id: 'tk-2' },
      },
      undefined,
    )
  })

  it('lists relay tokens', async () => {
    requestMock.get.mockResolvedValue({
      data: {
        items: [{ id: 'tk-1' }],
        total: 1,
        page: 1,
        pageSize: 20,
      },
    })

    const result = await relayTokenService.getRelayTokens()

    expect(requestMock.get).toHaveBeenCalledWith(
      expectOperation('RelayControllerListTokens'),
      {
        params: { page: undefined, pageSize: undefined },
      },
      undefined,
    )
    expect(result).toEqual({
      items: [{ id: 'tk-1' }],
      total: 1,
      page: 1,
      pageSize: 20,
    })
  })

  it('gets relay token by id', async () => {
    requestMock.get.mockResolvedValue({ data: { id: 'tk-5' } })

    const result = await relayTokenService.getRelayTokenById('tk-5')

    expect(requestMock.get).toHaveBeenCalledWith(
      expectOperation('RelayControllerGetToken'),
      {
        params: { targetUserId: undefined },
        path: { id: 'tk-5' },
      },
      undefined,
    )
    expect(result).toEqual({ id: 'tk-5' })
  })

  it('updates token and toggles status', async () => {
    requestMock.put.mockResolvedValue({ data: { id: 'tk-3', name: 'updated' } })
    requestMock.patch.mockResolvedValue({ data: { id: 'tk-3', status: 0 } })

    const updateResult = await relayTokenService.updateToken('tk-3', {
      name: 'updated',
    } as any)
    const toggleResult = await relayTokenService.toggleTokenStatus('tk-3')

    expect(requestMock.put).toHaveBeenCalledWith(
      expectOperation('RelayControllerUpdateToken'),
      {
        path: { id: 'tk-3' },
        body: { name: 'updated' },
      },
      undefined,
    )
    expect(requestMock.patch).toHaveBeenCalledWith(
      expectOperation('RelayControllerToggleTokenStatus'),
      {
        path: { id: 'tk-3' },
      },
      undefined,
    )
    expect(updateResult).toEqual({ id: 'tk-3', name: 'updated' })
    expect(toggleResult).toEqual({ id: 'tk-3', status: 0 })
  })

  it('passes wildcard failover rules through create and update payloads', async () => {
    requestMock.post.mockResolvedValue({ data: { id: 'tk-10' } })
    requestMock.put.mockResolvedValue({ data: { id: 'tk-10' } })

    const payload = {
      failoverConfig: {
        enabled: true,
        maxRetries: 2,
        retryStatusCodes: ['4xx', '/^5(02|03)$/'],
      },
    } as any

    await relayTokenService.createRelayToken(payload)
    await relayTokenService.updateToken('tk-10', payload)

    expect(requestMock.post).toHaveBeenCalledWith(
      expectOperation('RelayControllerCreateToken'),
      {
        body: payload,
      },
      undefined,
    )
    expect(requestMock.put).toHaveBeenCalledWith(
      expectOperation('RelayControllerUpdateToken'),
      {
        path: { id: 'tk-10' },
        body: payload,
      },
      undefined,
    )
  })

  it('gets available model map', async () => {
    requestMock.get.mockResolvedValue({
      data: {
        modelNames: ['gpt-4o', 'claude-3.5-sonnet'],
        modelIdToModelNameMap: { 'openai/gpt-4o': 'gpt-4o' },
        modelIdToModelNamesMap: {},
        modelIds: [],
      },
    })

    const result = await relayTokenService.getAvailableModels()

    expect(requestMock.get).toHaveBeenCalledWith(
      expectOperation('RelayControllerGetAvailableModels'),
      {},
      undefined,
    )
    expect(result).toEqual({
      modelNames: ['gpt-4o', 'claude-3.5-sonnet'],
      modelIdToModelNameMap: { 'openai/gpt-4o': 'gpt-4o' },
      modelIdToModelNamesMap: {},
      modelIds: [],
    })
  })

  it('normalizes malformed available model map payloads', async () => {
    requestMock.get.mockResolvedValue({
      data: {
        modelNames: [' gpt-4o ', '', null, 123],
        modelIdToModelNameMap: {
          ' openai/gpt-4o ': ' gpt-4o ',
          '': 'ignored',
          broken: '',
        },
        modelIdToModelNamesMap: {},
        modelIds: [],
      },
    })

    const result = await relayTokenService.getAvailableModels()

    expect(result).toEqual({
      modelNames: ['gpt-4o', '123'],
      modelIdToModelNameMap: { 'openai/gpt-4o': 'gpt-4o' },
      modelIdToModelNamesMap: {},
      modelIds: [],
    })
  })

})
