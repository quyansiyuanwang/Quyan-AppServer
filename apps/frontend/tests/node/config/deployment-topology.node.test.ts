import { loadEnv } from 'vite'
import { describe, expect, it } from 'vitest'

describe('frontend deployment topology environment', () => {
  it('keeps production site and platform roots aligned', () => {
    const env = loadEnv('production', process.cwd(), '')

    expect(env.PLATFORM_ROOT_DOMAIN).toBe('qysyw.cn')
    expect(env.SITE_ROOT_DOMAIN).toBe('qysyw.cn')
    expect(env.VITE_PUBLIC_SITE_HOST).toBe('www.qysyw.cn')
  })

  it('uses the production platform with an explicit staging site root', () => {
    const env = loadEnv('staging', process.cwd(), '')

    expect(env.PLATFORM_ROOT_DOMAIN).toBe('qysyw.cn')
    expect(env.SITE_ROOT_DOMAIN).toBe('staging.qysyw.cn')
    expect(env.VITE_PUBLIC_SITE_HOST).toBe('staging.qysyw.cn')
  })
})
