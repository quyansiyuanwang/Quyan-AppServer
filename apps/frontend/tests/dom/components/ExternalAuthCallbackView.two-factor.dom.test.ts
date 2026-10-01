// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

const { callbackMock, restoreMock, openMock, pendingMock, replaceMock } = vi.hoisted(() => ({
  callbackMock: vi.fn(),
  restoreMock: vi.fn(),
  openMock: vi.fn(),
  pendingMock: vi.fn(),
  replaceMock: vi.fn(),
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({
    params: { provider: 'github' },
    query: {
      code: 'one-use-code',
      state: 'state',
      redirect: '/channels/probes',
      flowId: 'flow-123',
    },
  }),
  useRouter: () => ({ replace: replaceMock }),
}))
vi.mock('@/locales', () => ({ i18ns: { t: (key: string) => key } }))
vi.mock('@/service/twoFactorOverlayService', () => ({
  twoFactorOverlayService: { restore: restoreMock, open: openMock },
}))
vi.mock('@/service/socialAuthService', () => ({
  socialAuthService: {
    externalAuthCallback: callbackMock,
    isAuthData: vi.fn(() => false),
    isBindingRequiredData: vi.fn(() => false),
    isExternalIdentity: vi.fn(() => false),
  },
}))
vi.mock('@/service/authorizationService', () => ({
  authorizationService: {
    isTwoFactorChallengePayload: (value: { requiresTwoFactor?: boolean }) =>
      value.requiresTwoFactor === true,
    setPendingTwoFactorChallenge: pendingMock,
    isPolicyConsentPayload: vi.fn(() => false),
  },
}))
vi.mock('@/service/centralLoginService', () => ({
  completeCentralLogin: vi.fn(),
  getDefaultAccountDestination: vi.fn(),
}))
vi.mock('@/service/navigationService', () => ({ replaceDocument: vi.fn() }))
vi.mock('@/utils/requestErrorNotice', () => ({ showRequestErrorNotice: vi.fn() }))
vi.mock('@/utils/elementPlusRuntime', () => ({ ElMessage: { error: vi.fn(), warning: vi.fn() } }))

import ExternalAuthCallbackView from '@/views/auth/ExternalAuthCallbackView.vue'

const mountCallback = () =>
  mount(ExternalAuthCallbackView, {
    global: { stubs: { 'el-card': true, 'el-skeleton': true } },
  })

describe('OAuth callback with 2FA overlay', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    restoreMock.mockReturnValue(false)
    callbackMock.mockResolvedValue({ requiresTwoFactor: true, challengeToken: 'challenge-1' })
  })

  it('keeps the callback route mounted until the overlay verifies the account', async () => {
    const wrapper = mountCallback()
    await vi.waitFor(() => expect(openMock).toHaveBeenCalledTimes(1))
    expect(openMock).toHaveBeenCalledWith({
      challengeToken: 'challenge-1',
      purpose: 'login',
      method: 'code',
      authEntry: 'login',
      redirect: '/channels/probes',
      flowId: 'flow-123',
    })
    expect(pendingMock).toHaveBeenCalledWith('challenge-1', '/channels/probes', 'login')
    expect(replaceMock).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('does not exchange the consumed authorization code after a refresh with a pending challenge', async () => {
    restoreMock.mockReturnValue(true)
    const wrapper = mountCallback()
    await vi.waitFor(() => expect(restoreMock).toHaveBeenCalledTimes(1))
    expect(callbackMock).not.toHaveBeenCalled()
    expect(replaceMock).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
