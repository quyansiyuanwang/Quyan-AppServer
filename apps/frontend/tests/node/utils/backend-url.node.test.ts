import { describe, expect, it } from 'vitest'
import { buildBackendUrl } from '@/utils/backend-url'

describe('buildBackendUrl', () => {
  it('keeps the relative path when VITE_BACKEND_URL is blank (same-origin dev proxy)', () => {
    expect(buildBackendUrl('/v1/heatmap/collect', '')).toBe('/v1/heatmap/collect')
    expect(buildBackendUrl('/v1/heatmap/collect', '   ')).toBe('/v1/heatmap/collect')
  })

  it('prefixes API paths with the configured absolute backend origin', () => {
    expect(buildBackendUrl('/v1/heatmap/collect', 'https://api.qysyw.cn')).toBe(
      'https://api.qysyw.cn/v1/heatmap/collect',
    )
    expect(buildBackendUrl('/v1/heatmap/collect', 'https://api.qysyw.cn/')).toBe(
      'https://api.qysyw.cn/v1/heatmap/collect',
    )
  })

  it('normalizes a missing leading slash on the path', () => {
    expect(buildBackendUrl('v1/heatmap/collect', 'https://api.qysyw.cn')).toBe(
      'https://api.qysyw.cn/v1/heatmap/collect',
    )
  })

  it('returns absolute path arguments unchanged', () => {
    expect(buildBackendUrl('https://other.example/v1/x', 'https://api.qysyw.cn')).toBe(
      'https://other.example/v1/x',
    )
  })
})
