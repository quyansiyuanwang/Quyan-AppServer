import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { UserDto } from '@/client/types.gen'
import { useSessionStore } from '@/stores/sessionStore'

const user = (id: string) => ({ id }) as UserDto

describe('session store identity projection key', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('does not change the remount token for the first restored identity', () => {
    const store = useSessionStore()

    expect(store.identityKey).toBe('0')
    store.setUser(user('user-1'))
    expect(store.identityKey).toBe('0')

    store.setUser(user('user-2'))
    expect(store.identityKey).toBe('1')

    store.setAnonymous()
    expect(store.identityKey).toBe('2')
  })

  it('changes the remount token after an anonymous cold-start session ends', () => {
    const store = useSessionStore()

    store.setAnonymous()
    expect(store.identityKey).toBe('0')

    store.setUser(user('user-1'))
    expect(store.identityKey).toBe('1')
  })
})
