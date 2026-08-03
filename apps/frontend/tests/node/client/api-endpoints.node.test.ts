import { describe, expect, it } from 'vitest'
import * as apiEndpoints from '@/client/api-endpoints.gen'

type EndpointConfig = {
  hasPath: boolean
}

describe('api-endpoints generated builders', () => {
  it('executes every build*Url function and replaces all path placeholders', () => {
    const buildFns = Object.entries(apiEndpoints).filter(
      ([name, value]) => name.startsWith('build') && typeof value === 'function',
    ) as Array<[string, (...args: Array<string | number>) => string]>

    expect(buildFns.length).toBeGreaterThan(0)

    for (const [name, fn] of buildFns) {
      const args = Array.from({ length: fn.length }, (_, index) => `value-${index + 1}`)
      const url = fn(...args)
      const endpointName = name.slice('build'.length, -'Url'.length)
      const endpointConfig = (apiEndpoints as Record<string, unknown>).API_ENDPOINTS as
        | Record<string, EndpointConfig>
        | undefined
      const hasPathParam = endpointConfig?.[endpointName]?.hasPath === true

      expect(url.startsWith('/')).toBe(true)
      expect(url.includes('{')).toBe(false)
      expect(url.includes('}')).toBe(false)

      if (hasPathParam) {
        expect(url).toContain('value-1')
      }

      expect(name).toMatch(/^build[A-Z].*Url$/)
    }
  })
})
