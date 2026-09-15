import { constants, generateKeyPairSync, privateDecrypt } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getPasswordEncryptionKey = vi.fn()

vi.mock('@/stores/request', () => ({
  useRequestStore: () => ({ getAxios: () => ({}) }),
}))

vi.mock('@/client/services/auth-controller.gen', () => ({
  createAuthControllerApi: () => ({ getPasswordEncryptionKey }),
}))

import { PasswordEncryptionService } from '@/service/passwordEncryptionService'

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
})

describe('PasswordEncryptionService', () => {
  beforeEach(() => {
    getPasswordEncryptionKey.mockReset()
    getPasswordEncryptionKey.mockResolvedValue({
      code: 0,
      message: 'ok',
      data: {
        algorithm: 'RSA-OAEP-256',
        keyId: 'test-key',
        publicKey,
      },
    })
    PasswordEncryptionService.getInstance().invalidateKey()
  })

  it('encrypts with the cached server key', async () => {
    const service = PasswordEncryptionService.getInstance()
    const credential = await service.encrypt('password123')

    expect(credential).toMatchObject({ algorithm: 'RSA-OAEP-256', keyId: 'test-key' })
    expect(
      privateDecrypt(
        {
          key: privateKey,
          padding: constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: 'sha256',
        },
        Buffer.from(credential.ciphertext, 'base64'),
      ).toString('utf8'),
    ).toBe('password123')
  })

  it('refreshes the key and retries once when the server reports a stale key id', async () => {
    const service = PasswordEncryptionService.getInstance()
    const submit = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('stale key'), { code: 1048 }))
      .mockResolvedValueOnce('ok')

    await expect(service.runWithRetry('password123', submit)).resolves.toBe('ok')
    expect(getPasswordEncryptionKey).toHaveBeenCalledTimes(2)
    expect(submit).toHaveBeenCalledTimes(2)
  })
})
