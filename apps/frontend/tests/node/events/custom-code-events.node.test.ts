import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { customCodeBus } from '@/stores/globalInstance'
import { registerCustomCodeEvents } from '@/events'

const { alertMock } = vi.hoisted(() => ({
  alertMock: vi.fn(),
}))

vi.mock('element-plus', () => ({
  ElMessageBox: {
    alert: alertMock,
  },
}))

vi.mock('@/locales', () => ({
  i18ns: {
    t: (key: string) => key,
  },
}))

vi.mock('@/utils/notification', () => ({
  Notification: {
    notify: vi.fn(),
  },
}))

vi.mock('@/stores/userInfoStore', () => ({
  useUserInfoStore: () => ({ clear: vi.fn() }),
}))

vi.mock('@/stores/permissionStore', () => ({
  usePermissionStore: () => ({ clearCurrentUserPermissions: vi.fn() }),
}))

vi.mock('@/stores/impersonationStore', () => ({
  useImpersonationStore: () => ({ isImpersonating: false }),
}))

vi.mock('@/router', () => ({
  default: {
    currentRoute: { value: { fullPath: '/' } },
    push: vi.fn(),
  },
}))

describe('custom code events', () => {
  let ipBlacklistListener: (payload: {
    code: number
    data?: { expireTime?: string; reason?: string }
  }) => unknown

  beforeEach(() => {
    alertMock.mockReset()
    registerCustomCodeEvents()
    ipBlacklistListener = customCodeBus._get_listeners('IP_BLACKLISTED').at(-1) as typeof ipBlacklistListener
  })

  afterEach(() => {
    customCodeBus.off('IP_BLACKLISTED', ipBlacklistListener)
  })

  it('opens one dialog for concurrent IP blacklist events and unlocks after dismissal', async () => {
    let resolveFirstDialog: (() => void) | undefined
    const firstDialog = new Promise<void>((resolve) => {
      resolveFirstDialog = resolve
    })
    const secondDialog = Promise.resolve()
    alertMock.mockReturnValueOnce(firstDialog).mockReturnValueOnce(secondDialog)

    const payload = {
      code: 1000,
      data: {
        reason: 'Too many requests',
        expireTime: '2099-01-01T00:00:00.000Z',
      },
    }

    ipBlacklistListener(payload)
    ipBlacklistListener(payload)
    ipBlacklistListener(payload)

    expect(alertMock).toHaveBeenCalledTimes(1)

    resolveFirstDialog?.()
    await firstDialog
    await Promise.resolve()

    ipBlacklistListener(payload)

    expect(alertMock).toHaveBeenCalledTimes(2)
  })
})