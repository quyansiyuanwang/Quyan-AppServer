import { createHmac } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ReplayProtection } from '@/utils/replay-protection'

const signingMaterial = {
  sessionId: 'session-1',
  signingKey: 'test-signing-key',
  algorithm: 'HMAC-SHA256' as const,
  expiresIn: 600,
  expiresAt: '2099-01-01T00:00:00.000Z',
}

const sign = (data: string) =>
  createHmac('sha256', signingMaterial.signingKey).update(data, 'utf8').digest('hex')

describe('ReplayProtection', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('generates headers with nonce, timestamp and deterministic sign for body payload', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)

    const headers = await ReplayProtection.generateHeaders(
      { a: 1 },
      '/permissions/user/u1',
      signingMaterial,
    )

    expect(headers['X-Timestamp']).toBe('1700000000')
    expect(headers['X-Nonce']).toMatch(/^[0-9a-f]{32}$/)
    expect(headers['X-Replay-Session-Id']).toBe('session-1')
    expect(headers['X-Sign']).toBe(
      sign(`${headers['X-Nonce']}1700000000/permissions/user/u1{"a":1}`),
    )
  })

  it('uses empty payload string when body is null', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000)

    const headers = await ReplayProtection.generateHeaders(null, '/auth/refresh', signingMaterial)

    expect(headers['X-Sign']).toBe(sign(`${headers['X-Nonce']}1800000000/auth/refresh`))
  })
})
