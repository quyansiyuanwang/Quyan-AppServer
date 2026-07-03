import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
}))

vi.stubGlobal('fetch', fetchMock)

import { getCaptchaRuntimeConfig, resetCaptchaLoader } from '@/utils/captcha'

describe('captcha runtime config parsing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetCaptchaLoader()
  })

  it('treats provider none as disabled', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          enabled: false,
          provider: 'none',
          fallbackProvider: 'none',
        },
      }),
    })

    const result = await getCaptchaRuntimeConfig(true)
    expect(result).toEqual({
      enabled: false,
      provider: 'none',
      fallbackProvider: 'none',
    })
  })

  it('respects explicit enabled=false even when provider is recaptcha', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          enabled: false,
          provider: 'recaptcha',
          fallbackProvider: 'none',
        },
      }),
    })

    const result = await getCaptchaRuntimeConfig(true)
    expect(result.enabled).toBe(false)
    expect(result.provider).toBe('recaptcha')
  })

  it('keeps turnstile with recaptcha fallback enabled', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          enabled: true,
          provider: 'turnstile',
          fallbackProvider: 'recaptcha',
        },
      }),
    })

    const result = await getCaptchaRuntimeConfig(true)
    expect(result).toEqual({
      enabled: true,
      provider: 'turnstile',
      fallbackProvider: 'recaptcha',
    })
  })
})