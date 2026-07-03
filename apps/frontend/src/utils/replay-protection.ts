import CryptoJS from 'crypto-js'

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

/**
 * 防重放攻击工具
 */
export class ReplayProtection {
  /**
   * 生成防重放请求头
   */
  static generateHeaders(
    body: any,
    path: string,
    signingMaterial: ReplaySigningMaterial,
  ): Record<string, string> {
    const nonce = this.generateNonce()
    const timestamp = Math.floor(Date.now() / 1000).toString()
    const bodyStr = body ? JSON.stringify(body) : ''
    const sign = this.generateSign(nonce, timestamp, path, bodyStr, signingMaterial.signingKey)

    return {
      'X-Nonce': nonce,
      'X-Timestamp': timestamp,
      'X-Sign': sign,
      'X-Replay-Session-Id': signingMaterial.sessionId,
    }
  }

  /**
   * 生成随机Nonce
   */
  private static generateNonce(): string {
    const array = new Uint8Array(16)
    crypto.getRandomValues(array)
    return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('')
  }

  /**
   * 生成签名
   */
  private static generateSign(
    nonce: string,
    timestamp: string,
    path: string,
    body: string,
    signingKey: string,
  ): string {
    const data = `${nonce}${timestamp}${path}${body}`
    return CryptoJS.HmacSHA256(data, signingKey).toString()
  }
}
