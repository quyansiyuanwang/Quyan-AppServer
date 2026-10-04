import { beforeEach, describe, expect, it, vi } from 'vitest'
const { getOAuthScopes } = vi.hoisted(() => ({ getOAuthScopes: vi.fn() }))
vi.mock('@/service/oauthClientService', () => ({
  OAuthClientService: { getInstance: () => ({ getOAuthScopes }) },
}))
import { useOAuthScopeCatalog } from '@/composables/useOAuthScopeCatalog'

describe('useOAuthScopeCatalog', () => {
  beforeEach(() => vi.clearAllMocks())
  it('keeps an array during loading and deduplicates concurrent loads', async () => {
    let resolve!: (value: { scopes: [] }) => void
    getOAuthScopes.mockReturnValue(
      new Promise((done) => {
        resolve = done
      }),
    )
    const state = useOAuthScopeCatalog()
    expect(state.scopeCatalogReady.value).toBe(false)
    const first = state.loadScopeCatalog()
    expect(state.loadScopeCatalog()).toBe(first)
    expect(state.scopeCatalog.value).toEqual([])
    expect(state.scopeCatalogLoading.value).toBe(true)
    resolve({ scopes: [] })
    await first
    expect(getOAuthScopes).toHaveBeenCalledTimes(1)
    expect(state.scopeCatalogReady.value).toBe(true)
  })
  it('clears the catalog on failure and supports retry', async () => {
    const state = useOAuthScopeCatalog()
    getOAuthScopes.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ scopes: [] })
    await expect(state.loadScopeCatalog()).resolves.toBeUndefined()
    expect(state.scopeCatalog.value).toEqual([])
    expect(state.scopeCatalogReady.value).toBe(false)
    expect(state.scopeCatalogError.value).not.toBe('')
    await state.loadScopeCatalog()
    expect(state.scopeCatalogReady.value).toBe(true)
    expect(state.scopeCatalogError.value).toBe('')
  })
  it.each([undefined, {}, { scopes: undefined }])(
    'does not treat malformed catalog %j as loaded',
    async (response) => {
      getOAuthScopes.mockResolvedValue(response)
      const state = useOAuthScopeCatalog()
      await state.loadScopeCatalog()
      expect(state.scopeCatalog.value).toEqual([])
      expect(state.scopeCatalogReady.value).toBe(false)
    },
  )
})
