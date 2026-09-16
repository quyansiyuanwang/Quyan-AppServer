import type { EncryptedPasswordCredentialDto } from '@/client/types.gen'
import { createAuthControllerApi } from '@/client/services/auth-controller.gen'
import { CustomCode } from '@/constant/custom-code'
import { useRequestStore } from '@/stores/request'
import { cacheObject } from '@/utils/common'
import { toServiceError } from '@/utils/error-utils'

const authApi = cacheObject(() => createAuthControllerApi(useRequestStore().getAxios()))

interface ImportedPasswordKey {
  keyId: string
  key: CryptoKey
}

const decodeBase64 = (value: string): ArrayBuffer => {
  const binary = globalThis.atob(value)
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

const encodeBase64 = (value: ArrayBuffer): string => {
  const bytes = new Uint8Array(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return globalThis.btoa(binary)
}

const importPublicKey = async (publicKey: string): Promise<CryptoKey> => {
  const pemBody = publicKey
    .replace(/-----BEGIN PUBLIC KEY-----/g, '')
    .replace(/-----END PUBLIC KEY-----/g, '')
    .replace(/\s+/g, '')

  return globalThis.crypto.subtle.importKey(
    'spki',
    decodeBase64(pemBody),
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt'],
  )
}

export const isPasswordEncryptionKeyInvalidError = (source: unknown): boolean => {
  if (!source || typeof source !== 'object') return false
  const value = source as Record<string, any>
  if (Number(value.code) === CustomCode.PASSWORD_ENCRYPTION_KEY_INVALID) return true
  return (
    isPasswordEncryptionKeyInvalidError(value.data) ||
    isPasswordEncryptionKeyInvalidError(value.response?.data)
  )
}

export class PasswordEncryptionService {
  private static instance: PasswordEncryptionService | null = null
  private keyPromise: Promise<ImportedPasswordKey> | null = null

  private constructor() {}

  static getInstance(): PasswordEncryptionService {
    if (!this.instance) this.instance = new PasswordEncryptionService()
    return this.instance
  }

  invalidateKey(): void {
    this.keyPromise = null
  }

  private async loadKey(force = false): Promise<ImportedPasswordKey> {
    if (!force && this.keyPromise) return this.keyPromise

    const loading = authApi
      .getPasswordEncryptionKey()
      .then(async (result) => {
        if (result.code !== CustomCode.OK || !result.data)
          throw toServiceError(result, 'Failed to load password encryption key')
        if (result.data.algorithm !== 'RSA-OAEP-256')
          throw new Error(`Unsupported password encryption algorithm: ${result.data.algorithm}`)

        return {
          keyId: result.data.keyId,
          key: await importPublicKey(result.data.publicKey),
        }
      })
      .catch((error) => {
        this.keyPromise = null
        throw error
      })

    this.keyPromise = loading
    return loading
  }

  async encrypt(password: string): Promise<EncryptedPasswordCredentialDto> {
    if (!password) throw new Error('Password is required')
    const { keyId, key } = await this.loadKey()
    const ciphertext = await globalThis.crypto.subtle.encrypt(
      { name: 'RSA-OAEP' },
      key,
      new TextEncoder().encode(password),
    )

    return {
      algorithm: 'RSA-OAEP-256',
      keyId,
      ciphertext: encodeBase64(ciphertext),
    }
  }

  async runWithRetry<T>(
    password: string,
    submit: (credential: EncryptedPasswordCredentialDto) => Promise<T>,
  ): Promise<T> {
    try {
      return await submit(await this.encrypt(password))
    } catch (error) {
      if (!isPasswordEncryptionKeyInvalidError(error)) throw error
      this.invalidateKey()
      return submit(await this.encrypt(password))
    }
  }
}

export const passwordEncryptionService = PasswordEncryptionService.getInstance()
