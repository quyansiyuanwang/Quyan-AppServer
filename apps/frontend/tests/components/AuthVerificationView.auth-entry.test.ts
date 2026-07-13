import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

const { pushMock, getPendingTwoFactorChallengeMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  getPendingTwoFactorChallengeMock: vi.fn(),
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({
    query: {
      method: 'code',
      authEntry: 'register',
      redirect: '/home',
    },
  }),
  useRouter: () => ({
    push: pushMock,
    back: vi.fn(),
  }),
}))

vi.mock('@/router', () => ({
  default: {
    push: pushMock,
    back: vi.fn(),
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

vi.mock('@/composables/usePageDevice', () => ({
  usePageDevice: () => ({
    isDesktop: true,
  }),
}))

vi.mock('@/service/authorizationService', () => ({
  authorizationService: {
    clearPendingTwoFactorChallenge: vi.fn(),
    clearPendingPolicyConsentChallenge: vi.fn(),
    getPendingTwoFactorChallenge: getPendingTwoFactorChallengeMock,
    getPendingPolicyConsentChallenge: vi.fn(() => null),
    setPendingPolicyConsentChallenge: vi.fn(),
    reloadAuthStoresAfterLogin: vi.fn(),
    isPolicyConsentPayload: vi.fn(() => false),
    acceptPolicyConsent: vi.fn(),
    logout: vi.fn(),
  },
}))

vi.mock('@/service/legalPolicyService', () => ({
  legalPolicyService: {
    getCurrentPolicies: vi.fn(async () => []),
  },
}))

vi.mock('@/service/twoFactor/twoFactorAuthService', () => ({
  twoFactorAuthService: {
    verifyLoginChallenge: vi.fn(),
    sendLoginEmailCode: vi.fn(),
  },
}))

vi.mock('@/service/twoFactor/twoFactorManagementService', () => ({
  twoFactorManagementService: {
    disable: vi.fn(),
  },
}))

vi.mock('@/service/captchaDialogService', () => ({
  ensureCaptchaTrust: vi.fn(),
}))

vi.mock('@/stores/request', () => ({
  useRequestStore: () => ({
    retryPendingTwoFactorRequests: vi.fn(async () => []),
  }),
}))

vi.mock('@/utils/cookie', () => ({
  waitForCookie: vi.fn(async () => true),
}))

vi.mock('@/utils/validation', () => ({
  validateTwoFactorCode: vi.fn(() => true),
}))

vi.mock('element-plus', () => ({
  ElMessage: {
    warning: vi.fn(),
  },
  ElMessageBox: {
    confirm: vi.fn(),
  },
}))

import AuthVerificationView from '@/views/auth/AuthVerificationView.vue'

describe('AuthVerificationView auth entry context', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getPendingTwoFactorChallengeMock.mockReturnValue({
      challengeToken: 'challenge-1',
      redirect: '/home',
      authEntry: 'register',
      createdAt: Date.now(),
    })
  })

  it('returns to register route when verification originated from register', async () => {
   const wrapper = mount(AuthVerificationView, {
   global: {
   stubs: {
   TwoFactorChallengeCard: {
   template: '<div />',
   },
   SegmentedCodeInput: {
   template: '<div />',
   },
   MarkdownRenderer: {
   template: '<div />',
   },
   'el-button': {
   template: '<button><slot /></button>',
   },
   'el-dialog': {
   template: '<div><slot /><slot name="footer" /></div>',
   },
   'el-skeleton': {
   template: '<div><slot /></div>',
   },
   'el-empty': {
   template: '<div />',
   },
   'el-tabs': {
   template: '<div><slot /></div>',
   },
   'el-tab-pane': {
   template: '<div><slot /></div>',
   },
   'el-checkbox': {
   template: '<label><slot /></label>',
   },
   },
   },
   })
    await new Promise((resolve) => setTimeout(resolve, 0))

   await wrapper.get('.verify-actions button').trigger('click')

    expect(pushMock).toHaveBeenCalledWith({
      name: 'register',
      query: { redirect: '/home' },
    })
  })
})
