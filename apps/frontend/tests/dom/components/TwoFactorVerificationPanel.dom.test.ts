// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import type { TwoFactorOverlayContext } from '@/service/twoFactorOverlayService'

const {
  verifyMock,
  sendEmailMock,
  disableMock,
  completeLoginMock,
  clearPendingMock,
  retryMock,
  closeMock,
  pushMock,
} = vi.hoisted(() => ({
  verifyMock: vi.fn(),
  sendEmailMock: vi.fn(),
  disableMock: vi.fn(),
  completeLoginMock: vi.fn(),
  clearPendingMock: vi.fn(),
  retryMock: vi.fn(),
  closeMock: vi.fn(),
  pushMock: vi.fn(),
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {} }),
  useRouter: () => ({ push: pushMock, back: vi.fn() }),
}))
vi.mock('@/locales', () => ({ i18ns: { t: (key: string) => key } }))
vi.mock('@/service/twoFactorOverlayService', () => ({
  twoFactorOverlayService: { close: closeMock },
  TWO_FACTOR_OVERLAY_Z_INDEX: 3000,
  TWO_FACTOR_STATUS_CHANGED_EVENT: 'two-factor-status-changed',
}))
vi.mock('@/service/authorizationService', () => ({
  authorizationService: {
    completeLogin: completeLoginMock,
    clearPendingTwoFactorChallenge: clearPendingMock,
    getPendingTwoFactorChallenge: vi.fn(() => null),
    isPolicyConsentPayload: vi.fn(() => false),
    reloadAuthStoresAfterLogin: vi.fn(async () => undefined),
    logout: vi.fn(async () => undefined),
  },
}))
vi.mock('@/service/twoFactor/twoFactorAuthService', () => ({
  twoFactorAuthService: { verifyLoginChallenge: verifyMock, sendLoginEmailCode: sendEmailMock },
}))
vi.mock('@/service/twoFactor/twoFactorManagementService', () => ({
  twoFactorManagementService: { disable: disableMock },
}))
vi.mock('@/service/legalPolicyService', () => ({
  legalPolicyService: { getCurrentPolicies: vi.fn(async () => []) },
}))
vi.mock('@/service/captchaDialogService', () => ({ ensureCaptchaTrust: vi.fn() }))
vi.mock('@/service/centralLoginService', () => ({
  completeCentralLogin: vi.fn(async () => false),
  getDefaultAccountDestination: vi.fn(() => '/home'),
}))
vi.mock('@/service/navigationService', () => ({ replaceDocument: vi.fn() }))
vi.mock('@/config/site-registry', () => ({
  resolveCurrentSiteProfile: () => ({ id: 'management-ai' }),
}))
vi.mock('@/stores/request', () => ({
  useRequestStore: () => ({ retryPendingTwoFactorRequests: retryMock }),
}))
vi.mock('@/utils/cookie', () => ({ waitForCookie: vi.fn(async () => true) }))
vi.mock('@/utils/validation', () => ({ validateTwoFactorCode: vi.fn(() => true) }))
vi.mock('@/utils/notification', () => ({ Notification: { notify: vi.fn() } }))
vi.mock('@/composables/usePageDevice', () => ({ usePageDevice: () => ({ isDesktop: true }) }))
vi.mock('@/utils/elementPlusRuntime', () => ({
  ElMessage: { warning: vi.fn() },
  ElMessageBox: {
    confirm: vi.fn(async () => {
      throw new Error('stay')
    }),
  },
}))

import { Notification } from '@/utils/notification'
import { ElMessage } from '@/utils/elementPlusRuntime'
import TwoFactorVerificationPanel from '@/components/auth/TwoFactorVerificationPanel.vue'

const ChallengeStub = defineComponent({
  emits: ['update:code', 'update:recoveryCode', 'submit'],
  template: `<div>
    <button data-testid="totp" @click="$emit('update:code', '123456'); $emit('submit')">TOTP</button>
    <button data-testid="recovery" @click="$emit('update:recoveryCode', 'ABCD1234'); $emit('submit')">Recovery</button>
  </div>`,
})

const mountPanel = async (context: TwoFactorOverlayContext) => {
  const wrapper = mount(TwoFactorVerificationPanel, {
    props: { overlay: true, context },
    global: {
      stubs: {
        TwoFactorChallengeCard: ChallengeStub,
        SegmentedCodeInput: {
          emits: ['update:modelValue'],
          template:
            '<button data-testid="email-entry" @click="$emit(\'update:modelValue\', \'654321\')">Code</button>',
        },
        MarkdownRenderer: { template: '<div />' },
        'el-button': {
          inheritAttrs: false,
          template: '<button @click="$emit(\'click\')"><slot /></button>',
        },
        'el-dialog': { template: '<div><slot /><slot name="footer" /></div>' },
        'el-skeleton': { template: '<div><slot /></div>' },
        'el-empty': { template: '<div />' },
        'el-tabs': { template: '<div><slot /></div>' },
        'el-tab-pane': { template: '<div><slot /></div>' },
        'el-checkbox': { template: '<label><slot /></label>' },
      },
    },
  })
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  return wrapper
}

describe('2FA overlay verification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    verifyMock.mockResolvedValue({
      access_token: 'access-token',
      user: { id: 'user-1' },
      oneTimeToken: 'once',
    })
    retryMock.mockResolvedValue([{ status: 'fulfilled' }])
    disableMock.mockResolvedValue({ enabled: false })
    sendEmailMock.mockResolvedValue({ maskedEmail: 'a***@example.com' })
  })
  afterEach(() => vi.useRealTimers())

  it('retries queued requests once after TOTP step-up without leaving the route', async () => {
    const wrapper = await mountPanel({
      challengeToken: 'challenge',
      method: 'code',
      purpose: 'stepup',
    })
    await wrapper.get('[data-testid="totp"]').trigger('click')
    await vi.waitFor(() => expect(retryMock).toHaveBeenCalledTimes(1))
    expect(verifyMock).toHaveBeenCalledWith({
      challengeToken: 'challenge',
      code: '123456',
      recoveryCode: undefined,
    })
    expect(completeLoginMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ preserveRefreshTokenIfMissing: true }),
    )
    expect(closeMock).toHaveBeenCalledTimes(1)
    expect(pushMock).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it.each(['invalid code', 'challenge expired'])(
    'keeps the overlay open after %s',
    async (reason) => {
      verifyMock.mockRejectedValueOnce(new Error(reason))
      const wrapper = await mountPanel({
        challengeToken: 'challenge',
        method: 'code',
        purpose: 'stepup',
      })
      await wrapper.get('[data-testid="recovery"]').trigger('click')
      await vi.waitFor(() => expect(verifyMock).toHaveBeenCalledTimes(1))
      expect(verifyMock).toHaveBeenCalledWith({
        challengeToken: 'challenge',
        code: undefined,
        recoveryCode: 'ABCD1234',
      })
      expect(retryMock).not.toHaveBeenCalled()
      expect(closeMock).not.toHaveBeenCalled()
      expect(Notification.notify).toHaveBeenCalledWith('error', reason, 'error', 3001)
      wrapper.unmount()
    },
  )

  it('keeps validation feedback above the full-screen overlay', async () => {
    const wrapper = await mountPanel({ method: 'code', purpose: 'login' })
    await wrapper.get('[data-testid="totp"]').trigger('click')
    expect(ElMessage.warning).toHaveBeenCalledWith({
      message: 'twoFactor.challengeMissing',
      zIndex: 3001,
    })
    expect(verifyMock).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('completes a login from registration without navigating on verification failure', async () => {
    const onCompleted = vi.fn()
    const wrapper = await mountPanel({
      challengeToken: 'challenge',
      method: 'code',
      purpose: 'login',
      authEntry: 'register',
      onCompleted,
    })
    await wrapper.get('[data-testid="totp"]').trigger('click')
    await vi.waitFor(() => expect(onCompleted).toHaveBeenCalledTimes(1))
    expect(completeLoginMock).toHaveBeenCalledTimes(1)
    expect(closeMock).toHaveBeenCalledTimes(1)
    expect(pushMock).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('lets a user send an email code without auto-closing the overlay', async () => {
    const wrapper = await mountPanel({
      challengeToken: 'challenge',
      method: 'email',
      purpose: 'login',
    })
    const buttons = wrapper.findAll('button')
    const sendButton = buttons.find((button) => button.text().includes('twoFactor.sendEmailCode'))
    expect(sendButton).toBeDefined()
    await sendButton!.trigger('click')
    await vi.waitFor(() => expect(sendEmailMock).toHaveBeenCalledTimes(1))
    expect(closeMock).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('enforces a visible cooldown between email-code sends', async () => {
    const wrapper = await mountPanel({
      challengeToken: 'challenge',
      method: 'email',
      purpose: 'login',
    })
    vi.useFakeTimers()
    const send = wrapper
      .findAll('button')
      .find((button) => button.text().includes('twoFactor.sendEmailCode'))!
    await send.trigger('click')
    await Promise.resolve()
    await wrapper.vm.$nextTick()
    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('loginOrRegisterPage.resendIn')
    await vi.advanceTimersByTimeAsync(60_000)
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('twoFactor.sendEmailCode')
    wrapper.unmount()
  })

  it('submits the email code for step-up and resumes the original request once', async () => {
    const wrapper = await mountPanel({
      challengeToken: 'challenge',
      method: 'email',
      purpose: 'stepup',
    })
    await wrapper.get('[data-testid="email-entry"]').trigger('click')
    const submit = wrapper
      .findAll('button')
      .find((button) => button.text().includes('twoFactor.submitEmailCode'))
    expect(submit).toBeDefined()
    await submit!.trigger('click')
    await vi.waitFor(() => expect(retryMock).toHaveBeenCalledTimes(1))
    expect(verifyMock).toHaveBeenCalledWith({ challengeToken: 'challenge', emailCode: '654321' })
    expect(closeMock).toHaveBeenCalledTimes(1)
    expect(pushMock).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('disables 2FA in place', async () => {
    const onCompleted = vi.fn()
    const wrapper = await mountPanel({ method: 'code', purpose: 'disable2fa', onCompleted })
    await wrapper.get('[data-testid="totp"]').trigger('click')
    await vi.waitFor(() => expect(disableMock).toHaveBeenCalledTimes(1))
    expect(onCompleted).toHaveBeenCalledTimes(1)
    expect(closeMock).toHaveBeenCalledTimes(1)
    expect(pushMock).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
