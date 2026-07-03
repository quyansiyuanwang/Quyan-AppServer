import StorageKey from '@/constant/storagekey'
import { CustomCode } from '@/constant/custom-code'
import { getOrCreateClientFingerprint } from '@/utils/client-fingerprint'
import type { ReplaySigningMaterial } from '@/utils/replay-protection'
import { isReplaySigningMaterialUsable } from '@/utils/replay-protection'

interface ReplaySigningSessionResponse {
  code: number
  message: string
  data?: ReplaySigningMaterial
}

const REPLAY_SIGNING_SESSION_PATH = '/v1/auth/replay-signing-session'

const isReplaySigningMaterial = (value: unknown): value is ReplaySigningMaterial => {
  if (!value || typeof value !== 'object') return false

  const candidate = value as Partial<ReplaySigningMaterial>
  return (
    typeof candidate.sessionId === 'string' &&
    typeof candidate.signingKey === 'string' &&
    candidate.algorithm === 'HMAC-SHA256' &&
    typeof candidate.expiresIn === 'number' &&
    typeof candidate.expiresAt === 'string'
  )
}

const buildReplaySigningSessionUrl = (): string => {
  const configuredBaseUrl = String(import.meta.env.VITE_BACKEND_URL || '').trim()
  const isAbsolute = /^https?:\/\//.test(configuredBaseUrl)
  const baseUrl = isAbsolute ? configuredBaseUrl : window.location.origin
  const prefix = isAbsolute ? '' : configuredBaseUrl
  return new URL(prefix + REPLAY_SIGNING_SESSION_PATH, baseUrl).toString()
}

export class ReplaySigningService {
  private static instance: ReplaySigningService | null = null
  private inflightPromise: Promise<ReplaySigningMaterial> | null = null

  static getInstance(): ReplaySigningService {
    if (!this.instance) {
      this.instance = new ReplaySigningService()
    }

    return this.instance
  }

  getStoredSigningMaterial(): ReplaySigningMaterial | null {
    try {
      const raw = sessionStorage.getItem(StorageKey.Auth.REPLAY_SIGNING_SESSION)
      if (!raw) return null

      const parsed: unknown = JSON.parse(raw)
      if (!isReplaySigningMaterial(parsed)) {
        this.clearSigningMaterial()
        return null
      }

      if (!isReplaySigningMaterialUsable(parsed)) {
        this.clearSigningMaterial()
        return null
      }

      return parsed
    } catch {
      this.clearSigningMaterial()
      return null
    }
  }

  setStoredSigningMaterial(material: ReplaySigningMaterial): void {
    sessionStorage.setItem(StorageKey.Auth.REPLAY_SIGNING_SESSION, JSON.stringify(material))
  }

  clearSigningMaterial(): void {
    sessionStorage.removeItem(StorageKey.Auth.REPLAY_SIGNING_SESSION)
  }

  async ensureSigningMaterial(force = false): Promise<ReplaySigningMaterial> {
    if (!force) {
      const existing = this.getStoredSigningMaterial()
      if (existing) return existing
    }

    if (!this.inflightPromise) {
      this.inflightPromise = this.fetchSigningMaterial().finally(() => {
        this.inflightPromise = null
      })
    }

    return this.inflightPromise
  }

  async refreshSigningMaterial(): Promise<ReplaySigningMaterial> {
    return this.ensureSigningMaterial(true)
  }

  private async fetchSigningMaterial(): Promise<ReplaySigningMaterial> {
    const fingerprint = getOrCreateClientFingerprint()
    const response = await fetch(buildReplaySigningSessionUrl(), {
      method: 'GET',
      credentials: 'include',
      headers: {
        ...(fingerprint ? { 'X-Client-Fingerprint': fingerprint } : {}),
      },
    })

    let payload: ReplaySigningSessionResponse | null = null
    try {
      payload = (await response.json()) as ReplaySigningSessionResponse
    } catch {
      payload = null
    }

    if (!response.ok || payload?.code !== CustomCode.OK || !isReplaySigningMaterial(payload.data)) {
      this.clearSigningMaterial()
      throw new Error(payload?.message || 'Failed to acquire replay signing session')
    }

    this.setStoredSigningMaterial(payload.data)
    return payload.data
  }
}
