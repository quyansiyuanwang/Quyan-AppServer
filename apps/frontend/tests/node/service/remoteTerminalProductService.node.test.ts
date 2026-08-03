import { beforeEach, describe, expect, it, vi } from 'vitest'
import { remoteTerminalProductService } from '@/service/remoteTerminalProductService'

const {
  getAxiosMock,
  apiFactoryMock,
  apiMethodsMock,
} = vi.hoisted(() => ({
  getAxiosMock: vi.fn(),
  apiFactoryMock: vi.fn(),
  apiMethodsMock: {
    listPublishedTemplates: vi.fn(),
    listCurrentUserEntitlements: vi.fn(),
    claimPublishedTemplate: vi.fn(),
    rotateRegistrationToken: vi.fn(),
    rotateCurrentUserRegistrationToken: vi.fn(),
    listCurrentUserDevices: vi.fn(),
    revokeCurrentUserDevice: vi.fn(),
  },
}))

vi.mock('@/stores/request', () => ({
  useRequestStore: () => ({
    getAxios: getAxiosMock,
  }),
}))

vi.mock('@/client/services/remote-terminal-product-controller.gen', () => ({
  createRemoteTerminalProductControllerApi: apiFactoryMock,
}))

describe('remoteTerminalProductService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getAxiosMock.mockReturnValue({ axios: true })
    apiFactoryMock.mockReturnValue(apiMethodsMock)
  })

  it('lists published templates from generated api', async () => {
    apiMethodsMock.listPublishedTemplates.mockResolvedValue({ data: [{ id: 'tpl-1', name: 'starter' }] })

    const result = await remoteTerminalProductService.listPublishedTemplates()

    expect(apiFactoryMock).toHaveBeenCalledWith({ axios: true })
    expect(apiMethodsMock.listPublishedTemplates).toHaveBeenCalledWith({})
    expect(result).toEqual([{ id: 'tpl-1', name: 'starter' }])
  })

  it('claims template with body payload and returns data', async () => {
    apiMethodsMock.claimPublishedTemplate.mockResolvedValue({
      data: { id: 'ent-1', templateId: 'tpl-1', purchasedDeviceCount: 1 },
    })

    const payload = {
      templateId: 'tpl-1',
      purchaseUnits: 7,
      deviceCount: 1,
      terminalCount: 2,
    }

    const result = await remoteTerminalProductService.claimTemplate(payload)

    expect(apiMethodsMock.claimPublishedTemplate).toHaveBeenCalledWith({ body: payload })
    expect(result).toEqual({ id: 'ent-1', templateId: 'tpl-1', purchasedDeviceCount: 1 })
  })

  it('rotates current user registration token with default empty payload', async () => {
    apiMethodsMock.rotateCurrentUserRegistrationToken.mockResolvedValue({
      data: { id: 'token-1', token: 'rtm_new_token' },
    })

    const result = await remoteTerminalProductService.rotateMyRegistrationToken('ent-1')

    expect(apiMethodsMock.rotateCurrentUserRegistrationToken).toHaveBeenCalledWith({
      path: { id: 'ent-1' },
      body: {},
    })
    expect(result).toEqual({ id: 'token-1', token: 'rtm_new_token' })
  })

  it('passes pagination params to list my devices', async () => {
    apiMethodsMock.listCurrentUserDevices.mockResolvedValue({
      data: { records: [{ id: 'dev-1' }], total: 1, page: 1, pageSize: 20 },
    })

    const result = await remoteTerminalProductService.listMyDevices({ page: 2, pageSize: 50, status: 1 })

    expect(apiMethodsMock.listCurrentUserDevices).toHaveBeenCalledWith({
      params: { page: 2, pageSize: 50, status: 1 },
    })
    expect(result.records).toEqual([{ id: 'dev-1' }])
  })

  it('revokes current user device through generated api path', async () => {
    apiMethodsMock.revokeCurrentUserDevice.mockResolvedValue({ code: 0 })

    await remoteTerminalProductService.revokeMyDevice('dev-1')

    expect(apiMethodsMock.revokeCurrentUserDevice).toHaveBeenCalledWith({
      path: { id: 'dev-1' },
    })
  })
})
