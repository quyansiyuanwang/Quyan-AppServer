import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CustomCode } from '@/constant/custom-code'

const { postMock } = vi.hoisted(() => ({
	postMock: vi.fn(),
}))

vi.mock('@/stores/request', () => ({
	useRequestStore: () => ({
		getAxios: () => ({
			post: postMock,
		}),
	}),
}))

import { captchaTrustService } from '@/service/captchaTrustService'

const expectOperation = (name: string) => expect.objectContaining({ name })

describe('captchaTrustService', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('posts provider/action/token and returns trust result', async () => {
		postMock.mockResolvedValueOnce({
			code: CustomCode.OK,
			data: {
				trusted: true,
				expiresInSeconds: 1800,
			},
		})

		const result = await captchaTrustService.verifyAndTrust('token-1', 'login', 'turnstile')

		expect(postMock).toHaveBeenCalledTimes(1)
		expect(postMock).toHaveBeenCalledWith(
			expectOperation('AuthControllerVerifyCaptchaTrust'),
			{
				body: {
					captchaToken: 'token-1',
					action: 'login',
					provider: 'turnstile',
				},
			},
			undefined,
		)
		expect(result).toEqual({ trusted: true, expiresInSeconds: 1800 })
	})
})
