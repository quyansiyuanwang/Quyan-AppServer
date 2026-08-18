import { describe, expect, it } from 'vitest'
import {
  getCentralLoginFallbackUrl,
  getCentralLoginUrl,
  removeCentralLoginFlowId,
} from '@/service/centralLoginService'
import { resolveSiteProfile } from '@/config/site-registry'

describe('central login navigation', () => {
  it('uses the registered auth origin and exposes only the opaque flow id', () => {
    const profile = resolveSiteProfile('ai.console.qysyw.cn')
    if (profile.id === 'rejected') throw new Error('Expected a registered profile')

    expect(getCentralLoginUrl(profile, '123e4567-e89b-12d3-a456-426614174000')).toBe(
      'https://auth.qysyw.cn/login?flowId=123e4567-e89b-12d3-a456-426614174000',
    )
  })

  it('builds a same-environment auth fallback without a cross-origin redirect', () => {
    const profile = resolveSiteProfile('ai.console.qysyw.test')
    if (profile.id === 'rejected') throw new Error('Expected a registered profile')

    expect(getCentralLoginFallbackUrl(profile)).toBe('https://auth.qysyw.test:5173/login')
  })

  it('removes an expired flow id without dropping the login redirect', () => {
    expect(
      removeCentralLoginFlowId('/auth/verify?method=code&flowId=expired&redirect=%2Fhome#resume'),
    ).toBe('/auth/verify?method=code&redirect=%2Fhome#resume')
  })

  it('removes a malformed flow query parameter', () => {
    expect(removeCentralLoginFlowId('/login?flowId&redirect=%2Fhome')).toBe(
      '/login?redirect=%2Fhome',
    )
  })
})
