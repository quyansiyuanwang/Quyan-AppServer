import { computed, reactive } from 'vue'
import StorageKey from '@/constant/storagekey'
import { TypedSessionStorage } from '@/utils/typedSessionStorage'

export const TWO_FACTOR_STATUS_CHANGED_EVENT = 'two-factor-status-changed'
export const TWO_FACTOR_OVERLAY_Z_INDEX = 3000

export type TwoFactorOverlayMethod = 'code' | 'email' | 'passkey'
export type TwoFactorOverlayPurpose = 'login' | 'disable2fa' | 'stepup'
export type TwoFactorOverlayAuthEntry = 'login' | 'register'

export interface TwoFactorOverlayContext {
  challengeToken?: string
  method: TwoFactorOverlayMethod
  purpose: TwoFactorOverlayPurpose
  redirect?: string
  authEntry?: TwoFactorOverlayAuthEntry
  flowId?: string
  onCompleted?: () => void | Promise<void>
  createdAt?: number
}

type PersistedTwoFactorOverlayContext = Omit<
  TwoFactorOverlayContext,
  'challengeToken' | 'onCompleted'
> & {
  createdAt: number
}

const state = reactive<{
  visible: boolean
  context: TwoFactorOverlayContext | null
}>({
  visible: false,
  context: null,
})

const persistenceKey = StorageKey.Auth.PENDING_TWO_FACTOR_OVERLAY

const persist = (context: TwoFactorOverlayContext) => {
  const persisted: PersistedTwoFactorOverlayContext = {
    method: context.method,
    purpose: context.purpose,
    ...(context.redirect ? { redirect: context.redirect } : {}),
    ...(context.authEntry ? { authEntry: context.authEntry } : {}),
    ...(context.flowId ? { flowId: context.flowId } : {}),
    createdAt: context.createdAt || Date.now(),
  }
  TypedSessionStorage.setItem(persistenceKey, JSON.stringify(persisted))
}

const clearPersisted = () => {
  TypedSessionStorage.removeItem(persistenceKey)
}

const normalizePersistedContext = (value: unknown): PersistedTwoFactorOverlayContext | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const method = record.method
  const purpose = record.purpose
  const createdAt = Number(record.createdAt)

  if (
    !['code', 'email', 'passkey'].includes(String(method)) ||
    !['login', 'disable2fa', 'stepup'].includes(String(purpose)) ||
    !Number.isFinite(createdAt)
  ) {
    return null
  }

  return {
    method: method as TwoFactorOverlayMethod,
    purpose: purpose as TwoFactorOverlayPurpose,
    ...(typeof record.redirect === 'string' ? { redirect: record.redirect } : {}),
    ...(record.authEntry === 'login' || record.authEntry === 'register'
      ? { authEntry: record.authEntry }
      : {}),
    ...(typeof record.flowId === 'string' ? { flowId: record.flowId } : {}),
    createdAt,
  }
}

const open = (context: TwoFactorOverlayContext): boolean => {
  if (state.visible && state.context) {
    // A second request can arrive while the first challenge is visible. Keep
    // the first challenge so all pending requests share one verification UI.
    return true
  }

  const normalized: TwoFactorOverlayContext = {
    ...context,
    method: context.method || 'code',
    purpose: context.purpose || 'stepup',
    createdAt: context.createdAt || Date.now(),
  }

  state.context = normalized
  state.visible = true
  persist(normalized)
  return true
}

const restore = (): boolean => {
  if (state.visible) return true

  const raw = TypedSessionStorage.getItem(persistenceKey)
  if (!raw) return false

  try {
    const persisted = normalizePersistedContext(JSON.parse(raw))
    if (!persisted) {
      clearPersisted()
      return false
    }

    const rawChallenge = TypedSessionStorage.getItem(StorageKey.Auth.PENDING_TWO_FACTOR_CHALLENGE)
    let challengeToken: string | undefined
    try {
      const pending = JSON.parse(rawChallenge || 'null') as { challengeToken?: unknown } | null
      challengeToken =
        typeof pending?.challengeToken === 'string' ? pending.challengeToken : undefined
    } catch {
      challengeToken = undefined
    }
    if (persisted.purpose !== 'disable2fa' && !challengeToken) {
      clearPersisted()
      return false
    }

    return open({
      ...persisted,
      ...(challengeToken ? { challengeToken } : {}),
      createdAt: persisted.createdAt,
    })
  } catch {
    clearPersisted()
    return false
  }
}

const close = () => {
  state.visible = false
  state.context = null
  clearPersisted()
}

export const twoFactorOverlayService = {
  state,
  visible: computed(() => state.visible),
  open,
  restore,
  close,
  clearPersisted,
}
