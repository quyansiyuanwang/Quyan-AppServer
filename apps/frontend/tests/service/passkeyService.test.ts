import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CustomCode } from '@/constant/custom-code'

const { requestMock, completeLoginMock, isPolicyConsentPayloadMock } = vi.hoisted(() => ({
  requestMock: {
    post: vi.fn(),
  },
  completeLoginMock: vi.fn(),
  isPolicyConsentPayloadMock: vi.fn(() => false),
}))

vi.mock('@/stores/request', () => ({
  useRequestStore: () => ({
    getAxios: () => requestMock,
  }),
}))

vi.mock('@/service/authorizationService', () => ({
  authorizationService: {
    completeLogin: completeLoginMock,
    isPolicyConsentPayload: isPolicyConsentPayloadMock,
  },
}))

import { passkeyService } from '@/service/passkeyService'

describe('passkeyService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requestMock.post.mockReset()
    isPolicyConsentPayloadMock.mockReturnValue(false)
  })

  it('completes login when the HTTP response contains only an access token', async () => {
    const authPayload = { access_token: 'access.token.value' }
    requestMock.post.mockResolvedValueOnce({
      code: CustomCode.OK,
      message: '操作成功',
      data: authPayload,
    })

    await expect(passkeyService.verifyAuth('session-1', {} as any)).resolves.toEqual(authPayload)
    expect(completeLoginMock).toHaveBeenCalledWith(authPayload)
  })
})
