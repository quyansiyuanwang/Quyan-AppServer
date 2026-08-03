// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'

const { ensureCaptchaTrustMock, warmupCaptchaTrustMock } = vi.hoisted(() => ({
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

vi.mock('@/utils/typedLocalStorage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/typedLocalStorage')>()
  return {
    ...actual,
    TypedLocalStorage: {
      ...actual.TypedLocalStorage,
      get: vi.fn(() => null),
      set: vi.fn(),
    },
  }
})

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
import { useLoginOrRegister } from '@/views/auth/login-or-register/useLoginOrRegister'
import { authorizationService } from '@/service/authorizationService'
import { Notification } from '@/utils/notification'

const LoginHarness = defineComponent({
  setup: () => ({ state: useLoginOrRegister() }),
  template: '<div />',
})

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

  it('shows validation errors returned for a nickname entered as the username', async () => {
    vi.spyOn(authorizationService, 'login').mockResolvedValue({
      code: 422,
      message: '参数验证失败',
    } as any)

    const wrapper = mount(LoginHarness)
    const state = (wrapper.vm as any).state
    state.formRef.value = { validate: vi.fn(async () => true) }
    state.loginForm.username = '显示昵称'
    state.loginForm.password = 'password'
    state.loginForm.agreedToLegalPolicies = true

    await state.handleSubmit()

    expect(Notification.notify).toHaveBeenCalledWith('error', '参数验证失败', 'error')
  })
})
