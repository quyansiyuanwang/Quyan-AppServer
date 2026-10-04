import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CustomCode } from '@/constant/custom-code'
const { get } = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('@/stores/request', () => ({ useRequestStore: () => ({ getAxios: () => ({ get }) }) }))
import { OAuthClientService } from '@/service/oauthClientService'

describe('OAuthClientService scope envelope', () => {
  beforeEach(() => vi.clearAllMocks())
  it('returns the nested typed catalog, not the response envelope', async () => {
    const data = { scopes: [{ scope: 'profile', grantable: true }] }
    get.mockResolvedValue({ code: CustomCode.OK, message: 'ok', data })
    expect(await OAuthClientService.getInstance().getOAuthScopes()).toEqual(data)
    expect(get).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'OAuthControllerScopes' }),
      {},
      undefined,
    )
  })
  it('preserves API failures rather than returning undefined', async () => {
    get.mockResolvedValue({ code: CustomCode.FORBIDDEN, message: 'forbidden' })
    await expect(OAuthClientService.getInstance().getOAuthScopes()).rejects.toThrow()
  })
})
