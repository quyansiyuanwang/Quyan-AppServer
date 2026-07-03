import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'

const {
  ensureCaptchaTrustMock,
 warmupCaptchaTrustMock,
} = vi.hoisted(() => ({
  ensureCaptchaTrustMock: vi.fn(async () => false),
  warmupCaptchaTrustMock: vi.fn(() => new Promise<void>(() => undefined)),
}))

vi.mock('@/service/captchaDialogService', () => ({
  ensureCaptchaTrust: ensureCaptchaTrustMock,
 warmupCaptchaTrust: warmupCaptchaTrustMock,
}))

vi.mock('@/service/configService', () => ({
  configService: {
    getRegistrationStatus: vi.fn(async () => true),
  },
}))

vi.mock('@/service/authorizationService', () => ({
  authorizationService: {
    login: vi.fn(),
    register: vi.fn(),
    acceptPolicyConsent: vi.fn(),
    reloadAuthStoresAfterLogin: vi.fn(),
  },
}))

vi.mock('@/service/legalPolicyService', () => ({
  legalPolicyService: {
    getCurrentPolicies: vi.fn(async () => []),
  },
}))

vi.mock('@/service/passkeyService', () => ({
  passkeyService: {
    isSupported: vi.fn(() => false),
  },
}))

vi.mock('@/stores/waterMarkTextStore', () => ({
  useWaterMarkTextStore: () => ({
    setText: vi.fn(),
  }),
}))

vi.mock('@/router', () => ({
  default: {
    push: vi.fn(),
    replace: vi.fn(),
  },
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({
    name: 'login',
    query: {},
  }),
}))

vi.mock('@/locales', () => ({
  i18ns: {
    t: (key: string) => key,
    or_t: (_cond: boolean, a: string, _b: string) => a,
  },
}))

vi.mock('@/utils/notification', () => ({
  Notification: {
    notify: vi.fn(),
  },
}))

vi.mock('@/utils/typedLocalStorage', () => ({
  TypedLocalStorage: {
    get: vi.fn(() => null),
    set: vi.fn(),
  },
}))

vi.mock('@/utils/encryption', () => ({
  md5: (value: string) => value,
}))

vi.mock('@/components/common/MarkdownRenderer.vue', () => ({
  default: {
    name: 'MarkdownRenderer',
    template: '<div />',
    props: ['content'],
  },
}))

vi.mock('@/composables/usePageDevice', () => ({
  usePageDevice: () => ({
    isDesktop: true,
  }),
}))

import LoginOrRegisterView from '@/views/auth/LoginOrRegisterView.vue'

describe('LoginOrRegisterView Turnstile UX', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not request captcha trust on mount for login flow', async () => {
    const wrapper = mount(LoginOrRegisterView)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(wrapper.exists()).toBe(true)
    expect(ensureCaptchaTrustMock).not.toHaveBeenCalled()
    expect(warmupCaptchaTrustMock).toHaveBeenCalledWith('login')
  })
})
