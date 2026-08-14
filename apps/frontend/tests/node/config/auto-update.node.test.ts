import { describe, expect, it } from 'vitest'
import { extractEntryModule } from '@/config/auto-update'

describe('auto update entry detection', () => {
  it('reads the hashed application entry from a production document', () => {
    expect(
      extractEntryModule(
        '<script type="module" crossorigin src="/assets/index-Bpx9wg7P.js"></script>',
      ),
    ).toBe('/assets/index-Bpx9wg7P.js')
  })

  it('does not treat module preloads as the application entry', () => {
    expect(
      extractEntryModule(
        '<link rel="modulepreload" href="/assets/framework-D9m5x5OM.js"><script type="module" src="/assets/index-Bpx9wg7P.js"></script>',
      ),
    ).toBe('/assets/index-Bpx9wg7P.js')
  })

  it('rejects documents without a module entry', () => {
    expect(extractEntryModule('<script src="/assets/index.js"></script>')).toBeUndefined()
  })
})
