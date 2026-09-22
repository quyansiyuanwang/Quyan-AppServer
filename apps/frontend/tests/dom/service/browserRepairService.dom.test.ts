// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import StorageKey from '@/constant/storagekey'
import {
  clearApplicationStorage,
  diagnoseBrowser,
  resetBrowserData,
  deleteRepairDatabase,
} from '@/service/browserRepairService'
import { BROWSER_REPAIR_POLICY } from '@/constant/browser-repair'
const request = vi.hoisted(() => vi.fn())
vi.mock('@/utils/public-request', () => ({ publicRequest: request }))

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  request.mockReset()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('browser repair ownership and partial failures', () => {
  it('auth reset preserves preferences, other apps and business caches', () => {
    localStorage.setItem(StorageKey.Auth.REPLAY_SIGNING_SESSION, '{}')
    localStorage.setItem(StorageKey.Impersonation.SESSION_INFO, '{}')
    localStorage.setItem(StorageKey.Scope.CURRENT, 'user:123')
    localStorage.setItem(StorageKey.Theme.THEME_TOGGLE_IS_DARK, 'true')
    localStorage.setItem(`${StorageKey.Chat.SELECTED_MODEL}::user:123`, 'model')
    localStorage.setItem('other-app', 'keep')
    clearApplicationStorage(localStorage, 'auth')
    expect(localStorage.getItem(StorageKey.Auth.REPLAY_SIGNING_SESSION)).toBeNull()
    expect(localStorage.getItem(StorageKey.Scope.CURRENT)).toBeNull()
    expect(localStorage.getItem(StorageKey.Impersonation.SESSION_INFO)).toBeNull()
    expect(localStorage.getItem(StorageKey.Theme.THEME_TOGGLE_IS_DARK)).toBe('true')
    expect(localStorage.getItem(`${StorageKey.Chat.SELECTED_MODEL}::user:123`)).toBe('model')
    expect(localStorage.getItem('other-app')).toBe('keep')
    clearApplicationStorage(localStorage, 'all')
    clearApplicationStorage(localStorage, 'all')
    expect(localStorage.length).toBe(1)
  })
  it('clears local state even when the backend cannot clear cookies', async () => {
    request.mockRejectedValue(new Error('offline'))
    localStorage.setItem(StorageKey.Auth.ACCESS_TOKEN, 'fixture-token')
    const result = await resetBrowserData('auth', 'zh-CN')
    expect(localStorage.getItem(StorageKey.Auth.ACCESS_TOKEN)).toBeNull()
    expect(result).toContainEqual({ item: 'cookieInstructions', state: 'failed' })
    expect(result).toContainEqual({ item: 'localStorage', state: 'ok' })
  })
  it('diagnoses corrupt known JSON without displaying its contents', async () => {
    localStorage.setItem(StorageKey.Auth.REPLAY_SIGNING_SESSION, '{secret fixture')
    request.mockResolvedValue({ code: 0 })
    vi.stubGlobal('indexedDB', {
      open: () => {
        throw new Error('disabled')
      },
      deleteDatabase: () => {
        throw new Error('disabled')
      },
    })
    const result = await diagnoseBrowser('en')
    expect(result).toContainEqual({ item: 'localStorage', state: 'failed' })
    expect(result).toContainEqual({ item: 'indexedDB', state: 'failed' })
    expect(result).toContainEqual({ item: 'cookies', state: 'unknown' })
    expect(JSON.stringify(result)).not.toContain('secret')
    expect(localStorage.getItem(StorageKey.Auth.REPLAY_SIGNING_SESSION)).toBe('{secret fixture')
  })
  it('bounds blocked database deletion', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('indexedDB', { deleteDatabase: () => ({}) })
    const deletion = deleteRepairDatabase('fixture-db')
    const assertion = expect(deletion).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(BROWSER_REPAIR_POLICY.operationTimeoutMs)
    await assertion
  })
  it('reports incomplete enumeration and never deletes a foreign database', async () => {
    request.mockResolvedValue({ code: 0, data: { cookiesCleared: true, sessionRevoked: true } })
    const removed: string[] = []
    vi.stubGlobal('indexedDB', {
      deleteDatabase: (name: string) => {
        removed.push(name)
        const request: { onsuccess?: () => void } = {}
        queueMicrotask(() => request.onsuccess?.())
        return request
      },
    })
    const results = await resetBrowserData('all', 'en')
    expect(results).toContainEqual({ item: 'databaseCoverage', state: 'unknown' })
    expect(removed.every((name) => name.startsWith('AppServerSessionDB'))).toBe(true)
  })
})

it('reports storage denial and quota failures without stopping other checks', async () => {
  request.mockResolvedValue({ code: 0 })
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('quota', 'QuotaExceededError')
  })
  try {
    const results = await diagnoseBrowser('en')
    expect(results).toContainEqual({ item: 'localStorage', state: 'failed' })
    expect(results).toContainEqual({ item: 'backend', state: 'ok' })
  } finally {
    write.mockRestore()
  }
})
