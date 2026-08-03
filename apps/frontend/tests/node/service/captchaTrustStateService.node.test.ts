import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CustomCode } from '@/constant/custom-code'

const { getMock } = vi.hoisted(() => ({
 getMock: vi.fn(),
}))

vi.mock('@/stores/request', () => ({
 useRequestStore: () => ({
 getAxios: () => ({
 get: getMock,
 }),
 }),
}))

import { captchaTrustStateService } from '@/service/captchaTrustStateService'

const expectOperation = (name: string) => expect.objectContaining({ name })

describe('captchaTrustStateService', () => {
 beforeEach(() => {
 vi.clearAllMocks()
 })

 it('returns trust status on OK response', async () => {
 getMock.mockResolvedValueOnce({
 code: CustomCode.OK,
 data: {
 trusted: true,
 expiresInSeconds:600,
 },
 })

 await expect(captchaTrustStateService.getTrustStatus()).resolves.toEqual({
 trusted: true,
 expiresInSeconds:600,
 })
 expect(getMock).toHaveBeenCalledWith(
 expectOperation('AuthControllerGetCaptchaTrustStatus'),
 {},
 undefined,
 )
 })
})