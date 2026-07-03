import { describe, expect, it } from 'vitest'
import { storage } from '@/utils/storage'

describe('storage util', () => {
  it('returns fallback when key is missing', () => {
    const value = storage.get('missing-key', { ok: true })
    expect(value).toEqual({ ok: true })
  })

  it('saves and reads JSON value', () => {
    storage.set('unit-storage-key', { score: 8 })
    const value = storage.get('unit-storage-key', { score: 0 })
    expect(value).toEqual({ score: 8 })
  })
})
