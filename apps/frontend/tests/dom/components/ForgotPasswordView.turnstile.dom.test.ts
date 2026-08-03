// @vitest-environment jsdom
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

vi.mock('@/service/authorizationService', () => ({
  authorizationService: {
    sendPasswordResetCode: vi.fn(),
    resetPassword: vi.fn(),
    getPendingPolicyConsentChallenge: vi.fn(() => null),
    setPendingPolicyConsentChallenge: vi.fn(),
    clearPendingPolicyConsentChallenge: vi.fn(),
  },
}))

vi.mock('@/stores/themeToggleStore', () => ({
  useThemeToggleStore: () => ({
    useIsDark: () => false,
  }),
}))

vi.mock('@/stores/waterMarkTextStore', () => ({
  useWaterMarkTextStore: () => ({
    setText: vi.fn(),
  }),
}))

vi.mock('@/router', () => ({
  default: {
    push: vi.fn(),
  },
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({ name: 'forgotPassword', query: {} }),
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

vi.mock('@/utils/encryption', () => ({
  md5: (value: string) => value,
}))

vi.mock('@/composables/usePageDevice', () => ({
  usePageDevice: () => ({
    isDesktop: true,
  }),
}))

vi.mock('@/components/auth/SegmentedCodeInput.vue', () => ({
  default: {
    name: 'SegmentedCodeInput',
    template: '<div />',
    props: ['modelValue'],
  },
}))

import ForgotPasswordView from '@/views/auth/ForgotPasswordView.vue'

describe('ForgotPasswordView Turnstile UX', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not request captcha trust on mount for reset password flow', async () => {
    const wrapper = mount(ForgotPasswordView)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(wrapper.exists()).toBe(true)
    expect(ensureCaptchaTrustMock).not.toHaveBeenCalled()
    expect(warmupCaptchaTrustMock).toHaveBeenCalledWith('reset_password')
  })
})
