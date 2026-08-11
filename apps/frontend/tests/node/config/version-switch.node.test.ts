import { describe, expect, it } from 'vitest'
import { resolveMultiDomainToLegacyUrl, sanitizeVersionSwitchSearch } from '@/config/version-switch'
import { resolveLegacyRoutePath } from '@/router/route-catalog'

describe('version switch navigation', () => {
  it('maps a product console capability URL to its origin/master route', () => {
    expect(resolveLegacyRoutePath('/links/team-a/link-b/analytics', ['product-short_link'])).toBe(
      '/products/short_link/analytics/team-a/link-b',
    )
    expect(resolveLegacyRoutePath('/api-keys', ['product-oj'])).toBe('/oj-submitter/apikeys')
    expect(
      resolveLegacyRoutePath('/products/remote-terminal/devices', ['management-terminal']),
    ).toBe('/products/remote-terminal')
  })

  it('falls back to the legacy home page when no equivalent page exists', () => {
    expect(resolveMultiDomainToLegacyUrl('https://legacy.qysyw.cn', '/not-available', '', '')).toBe(
      'https://legacy.qysyw.cn/home',
    )
  })

  it('preserves safe query/hash values while removing sensitive navigation values', () => {
    expect(
      resolveMultiDomainToLegacyUrl(
        'https://legacy.qysyw.test:5174',
        '/roles',
        '?range=30d&access_token=secret&return_url=https%3A%2F%2Fevil.example',
        '#activity',
        ['console-ram'],
      ),
    ).toBe('https://legacy.qysyw.test:5174/iam/ram?tab=roles&range=30d#activity')
    expect(sanitizeVersionSwitchSearch('?token=x&safe=true')).toBe('?safe=true')
  })

  it('rejects unsafe version-switch origins', () => {
    expect(
      resolveMultiDomainToLegacyUrl('http://legacy.qysyw.cn', '/workspace', '', ''),
    ).toBeUndefined()
    expect(
      resolveMultiDomainToLegacyUrl('https://legacy.qysyw.cn/app', '/workspace', '', ''),
    ).toBeUndefined()
  })
})
