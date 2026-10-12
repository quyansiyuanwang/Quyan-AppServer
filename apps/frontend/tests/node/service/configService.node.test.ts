import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SERVER_CONFIG_SECRET_PLACEHOLDER } from '@quyan/shared'
const { requestMock } = vi.hoisted(() => ({ requestMock: { get: vi.fn(), put: vi.fn() } }))
vi.mock('@/stores/request', () => ({ useRequestStore: () => ({ getAxios: () => requestMock }) }))
import { configService } from '@/service/configService'
beforeEach(() => {
  vi.clearAllMocks()
  requestMock.put.mockResolvedValue({ code: 0 })
})
describe('configuration secret presence markers', () => {
  it('preserves masked secrets while saving changed ordinary settings', async () => {
    await configService.setConfigs({
      'smtp.password': SERVER_CONFIG_SECRET_PLACEHOLDER,
      'smtp.host': 'mail.example.test',
    })
    expect(requestMock.put).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'ConfigControllerSetConfigs' }),
      { body: { configs: { 'smtp.host': 'mail.example.test' } } },
      undefined,
    )
  })
  it('sends explicit secret replacements and explicit clears', async () => {
    await configService.setConfigs({
      'smtp.password': 'fixture-new-value',
      'developer.sms.token': '',
    })
    expect(requestMock.put.mock.calls[0][1].body.configs).toEqual({
      'smtp.password': 'fixture-new-value',
      'developer.sms.token': '',
    })
  })
  it('does not save display markers alone and does not mask output-token counts', async () => {
    await configService.setConfigs({ 'smtp.password': SERVER_CONFIG_SECRET_PLACEHOLDER })
    expect(requestMock.put).not.toHaveBeenCalled()
    await configService.setConfigs({ 'supportAi.maxOutputTokens': '2048' })
    expect(requestMock.put.mock.calls[0][1].body.configs).toEqual({
      'supportAi.maxOutputTokens': '2048',
    })
  })
  it('keeps denied saves visible without attempting a second request', async () => {
    requestMock.put.mockResolvedValue({ code: 403 })
    await expect(configService.setConfigs({ 'smtp.host': 'mail' })).rejects.toThrow()
    expect(requestMock.put).toHaveBeenCalledTimes(1)
  })
})
