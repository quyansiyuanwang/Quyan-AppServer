import StorageKey from '@/constant/storagekey'
import { SESSION_DB_PREFIX, getSessionDbName } from '@/constant/session-db'
import {
  SHARED_PREFERENCE_KEYS,
  getSharedPreferenceCookieName,
  getSharedPreferenceCookieDomain,
} from '@/constant/preference-cookies'
import { BROWSER_REPAIR_POLICY as policy } from '@/constant/browser-repair'
import {
  AuthControllerResetBrowserState,
  AuthControllerGetCaptchaTrustStatus,
} from '@/client/api-descriptors/auth-controller.gen'
import { publicRequest } from '@/utils/public-request'

export type RepairState = 'ok' | 'failed' | 'unknown'
export type RepairItem = { item: string; state: RepairState }
export type RepairLevel = 'auth' | 'all'
const values = (value: object): string[] =>
  Object.values(value).flatMap((entry) => (typeof entry === 'string' ? [entry] : values(entry)))
const applicationKeys = values(StorageKey)
const authKeys = values({
  Fingerprint: StorageKey.Util.CLIENT_FINGERPRINT,
  Auth: StorageKey.Auth,
  Impersonation: StorageKey.Impersonation,
  Scope: StorageKey.Scope,
  User: StorageKey.User,
  Permission: StorageKey.Permission,
})

export const isApplicationStorageKey = (key: string, level: RepairLevel): boolean =>
  (level === 'all' ? applicationKeys : authKeys).some(
    (base) =>
      key === base ||
      key.startsWith(`${base}::`) ||
      ((
        [
          StorageKey.Navigation.PINNED_ROUTES,
          StorageKey.Overlay.FLOATING_WORKSPACE_STATE,
        ] as string[]
      ).includes(base) &&
        key.startsWith(`${base}:`)),
  ) ||
  (level === 'all' && key.startsWith(`${StorageKey.Easter.PASSIVE_CONFIG_PREFIX}-`))

const storageKeys = (storage: Storage): string[] =>
  Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(
    (key): key is string => key !== null,
  )

export function clearApplicationStorage(storage: Storage, level: RepairLevel): void {
  for (const key of storageKeys(storage)) {
    if (!isApplicationStorageKey(key, level)) continue
    storage.removeItem(key)
    if (storage.getItem(key) !== null) throw new Error('Storage removal failed')
  }
}

const bounded = <T>(work: Promise<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Repair operation timed out')),
      policy.operationTimeoutMs,
    )
    work.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })

export const deleteRepairDatabase = (name: string): Promise<void> =>
  bounded(
    new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(new Error('Database deletion failed'))
      // onblocked remains pending only up to the policy timeout; other tabs can close in the meantime.
    }),
  )

async function step(item: string, work: () => Promise<void> | void): Promise<RepairItem> {
  try {
    await work()
    return { item, state: 'ok' }
  } catch {
    return { item, state: 'failed' }
  }
}

function probeStorage(storage: Storage): void {
  const key = `${policy.probePrefix}${crypto.randomUUID()}`
  try {
    storage.setItem(key, '1')
    if (storage.getItem(key) !== '1') throw new Error('Storage unavailable')
  } finally {
    storage.removeItem(key)
  }
  // Only fields whose actual writers use JSON; raw tokens and scalar strings are not parsed.
  const objectKeys = [
    StorageKey.Auth.REPLAY_SIGNING_SESSION,
    StorageKey.Auth.PENDING_TWO_FACTOR_CHALLENGE,
    StorageKey.Auth.PENDING_POLICY_CONSENT_CHALLENGE,
    StorageKey.User.INFO,
  ]
  for (const key of storageKeys(storage)) {
    if (!objectKeys.some((base) => key === base || key.startsWith(`${base}::`))) continue
    const value = storage.getItem(key)
    if (value === null) continue
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('Invalid stored object')
  }
}

async function probeDatabase(): Promise<void> {
  const name = `${policy.probePrefix}${crypto.randomUUID()}`
  try {
    await bounded(
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(name, 1)
        request.onsuccess = () => {
          request.result.close()
          resolve()
          void deleteRepairDatabase(name).catch(() => {})
        }
        request.onerror = () => reject(new Error('Database unavailable'))
      }),
    )
  } finally {
    await deleteRepairDatabase(name)
  }
}

export async function diagnoseBrowser(locale: string): Promise<RepairItem[]> {
  return Promise.all([
    step('localStorage', () => probeStorage(window.localStorage)),
    step('sessionStorage', () => probeStorage(window.sessionStorage)),
    step('indexedDB', probeDatabase),
    step('backend', async () => {
      const result = (await publicRequest(AuthControllerGetCaptchaTrustStatus.url, {
        locale,
        timeoutMs: policy.operationTimeoutMs,
      })) as { code?: number }
      if (result.code !== 0) throw new Error('Backend probe failed')
    }),
    Promise.resolve({ item: 'cookies', state: 'unknown' } as RepairItem),
  ])
}

export async function resetBrowserData(level: RepairLevel, locale: string): Promise<RepairItem[]> {
  const results: RepairItem[] = []
  // Capture all known scopes BEFORE deleting storage. Enumeration failures do not stop local cleanup.
  const names = new Set([SESSION_DB_PREFIX, getSessionDbName('guest')])
  for (const kind of ['localStorage', 'sessionStorage'] as const) {
    try {
      const storage = window[kind]
      const scope = storage.getItem(StorageKey.Scope.CURRENT)
      if (scope) names.add(getSessionDbName(scope))
      for (const key of storageKeys(storage)) {
        if (!isApplicationStorageKey(key, 'all')) continue
        const separator = key.indexOf('::')
        if (separator >= 0) names.add(getSessionDbName(key.slice(separator + 2)))
      }
    } catch {
      /* Actual storage deletion below reports the failure. */
    }
  }
  if (level === 'all') {
    try {
      if (typeof indexedDB.databases !== 'function') throw new Error('Enumeration unsupported')
      const databases = await bounded(indexedDB.databases())
      for (const db of databases)
        if (
          db.name &&
          (db.name === SESSION_DB_PREFIX || db.name.startsWith(`${SESSION_DB_PREFIX}::`))
        )
          names.add(db.name)
    } catch {
      results.push({ item: 'databaseCoverage', state: 'unknown' })
    }
  }
  // The reset request does not depend on local auth state or replay material.
  try {
    const response = (await publicRequest(AuthControllerResetBrowserState.url, {
      method: 'POST',
      body: { confirm: true },
      headers: { 'X-Browser-State-Reset': '1' },
      locale,
      timeoutMs: policy.operationTimeoutMs,
    })) as { code?: number; data?: { cookiesCleared?: boolean; sessionRevoked?: boolean } }
    results.push({
      item: 'cookieInstructions',
      state: response.code === 0 && response.data?.cookiesCleared === true ? 'ok' : 'failed',
    })
    results.push({
      item: 'sessionRevocation',
      state: response.code === 0 && response.data?.sessionRevoked === true ? 'ok' : 'unknown',
    })
  } catch {
    results.push({ item: 'cookieInstructions', state: 'failed' })
  }
  for (const kind of ['localStorage', 'sessionStorage'] as const)
    results.push(await step(kind, () => clearApplicationStorage(window[kind], level)))
  if (level === 'all') {
    // Repair runs as its own document, with no business DB connection or reactive storage writers.
    const databaseResults = await Promise.all(
      [...names].map((name) => step('indexedDB', () => deleteRepairDatabase(name))),
    )
    results.push({
      item: 'indexedDB',
      state: databaseResults.every((result) => result.state === 'ok') ? 'ok' : 'failed',
    })
    results.push(
      await step('preferences', () => {
        const domain = getSharedPreferenceCookieDomain(location.hostname)
        for (const key of SHARED_PREFERENCE_KEYS) {
          const name = encodeURIComponent(getSharedPreferenceCookieName(key))
          const cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`
          document.cookie = cookie
          if (domain) document.cookie = `${cookie}; Domain=${domain}`
          if (document.cookie.split(';').some((entry) => entry.trim().startsWith(`${name}=`)))
            throw new Error('Cookie removal failed')
        }
      }),
    )
  }
  return results
}
