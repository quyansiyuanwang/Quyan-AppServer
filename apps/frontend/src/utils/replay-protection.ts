export interface ReplaySigningMaterial {
  sessionId: string
  signingKey: string
  algorithm: 'HMAC-SHA256'
  expiresIn: number
  expiresAt: string
}

export const isReplaySigningMaterialUsable = (
  material: ReplaySigningMaterial | null | undefined,
  bufferSeconds = 15,
): material is ReplaySigningMaterial => {
  if (!material) return false
  if (!material.sessionId?.trim() || !material.signingKey?.trim()) return false
  if (material.algorithm !== 'HMAC-SHA256') return false

  const expiresAt = Date.parse(material.expiresAt)
  if (!Number.isFinite(expiresAt)) return false

  return expiresAt - bufferSeconds * 1000 > Date.now()
}

const encoder = new TextEncoder()
const hmacKeys = new Map<string, Promise<CryptoKey>>()

const toHex = (value: ArrayBuffer): string =>
  Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, '0')).join('')

const getHmacKey = (signingKey: string): Promise<CryptoKey> => {
  let keyPromise = hmacKeys.get(signingKey)
  if (!keyPromise) {
    keyPromise = globalThis.crypto.subtle.importKey(
      'raw',
      encoder.encode(signingKey).buffer as ArrayBuffer,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    hmacKeys.set(signingKey, keyPromise)
  }
  return keyPromise
}

/**
 * 防重放攻击工具
 */
export class ReplayProtection {
  static async generateHeaders(
    body: unknown,
    path: string,
    signingMaterial: ReplaySigningMaterial,
  ): Promise<Record<string, string>> {
    const nonce = this.generateNonce()
    const timestamp = Math.floor(Date.now() / 1000).toString()
    let bodyStr = ''
    if (body instanceof Uint8Array) {
      const digest = await globalThis.crypto.subtle.digest(
        'SHA-256',
        body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
      )
      bodyStr = `sha256:${toHex(digest)}`
    } else if (body) {
      bodyStr = JSON.stringify(body)
    }

    const sign = await this.generateSign(
      nonce,
      timestamp,
      path,
      bodyStr,
      signingMaterial.signingKey,
    )

    return {
      'X-Nonce': nonce,
      'X-Timestamp': timestamp,
      'X-Sign': sign,
      'X-Replay-Session-Id': signingMaterial.sessionId,
    }
  }

  private static generateNonce(): string {
    const array = new Uint8Array(16)
    crypto.getRandomValues(array)
    return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('')
  }

  private static async generateSign(
    nonce: string,
    timestamp: string,
    path: string,
    body: string,
    signingKey: string,
  ): Promise<string> {
    const data = `${nonce}${timestamp}${path}${body}`
    const signature = await globalThis.crypto.subtle.sign(
      'HMAC',
      await getHmacKey(signingKey),
      encoder.encode(data).buffer as ArrayBuffer,
    )
    return toHex(signature)
  }
}
