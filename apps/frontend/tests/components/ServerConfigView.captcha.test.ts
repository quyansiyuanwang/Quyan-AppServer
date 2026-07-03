import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

const {
  getCaptchaConfigMock,
  setCaptchaConfigMock,
  getRegistrationConfigMock,
  getAllGroupsMock,
  warningMock,
  successMock,
} = vi.hoisted(() => ({
  getCaptchaConfigMock: vi.fn(async () => ({
    provider: 'none',
    fallbackProvider: 'none',
    minScore: 0.5,
    trustWindowMinutes: 30,
  })),
  setCaptchaConfigMock: vi.fn(async () => true),
  getRegistrationConfigMock: vi.fn(async () => ({
    enabled: true,
    maxAccountsPerEmail: 3,
    defaultGroupUsername: 'user',
    verificationCodeExpiry: 300,
  })),
  getAllGroupsMock: vi.fn(async () => []),
  warningMock: vi.fn(),
  successMock: vi.fn(),
}))

vi.mock('@/service/configService', () => ({
  configService: {
    getRegistrationConfig: getRegistrationConfigMock,
    getBillingConfig: vi.fn(async () => ({ rechargeRatio: 100 })),
    getCaptchaConfig: getCaptchaConfigMock,
    setCaptchaConfig: setCaptchaConfigMock,
    getSmtpConfig: vi.fn(),
    getIpBanConfig: vi.fn(),
    getConfigs: vi.fn(async () => ({})),
    setConfigs: vi.fn(async () => true),
    setRegistrationConfig: vi.fn(async () => true),
    setBillingConfig: vi.fn(async () => true),
    setSmtpConfig: vi.fn(async () => true),
    setIpBanConfig: vi.fn(async () => true),
  },
}))

vi.mock('@/service/groupService', () => ({
  groupService: {
    getAllGroups: getAllGroupsMock,
  },
}))

vi.mock('@/locales', () => ({
  i18ns: {
    t: (key: string) => key,
  },
}))

vi.mock('element-plus', () => ({
  ElMessage: {
    warning: warningMock,
    success: successMock,
    error: vi.fn(),
  },
}))

vi.mock('@/composables/usePageDevice', () => ({
  usePageDevice: () => ({
    isDesktop: true,
  }),
}))

import ServerConfigView from '@/views/system/ServerConfigView.vue'

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('ServerConfigView captcha configuration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('treats provider=none as disabled mode', async () => {
    const wrapper = mount(ServerConfigView)
    await flush()

    ;(wrapper.vm as any).activeNames = ['captcha']
    await flush()

    expect((wrapper.vm as any).captchaProvider).toBe('none')
    expect(wrapper.text()).toContain('ServerConfigView.captchaDisabledMode')
  })

  it('prevents fallback provider equal to primary provider', async () => {
    const wrapper = mount(ServerConfigView)
    await flush()

    ;(wrapper.vm as any).captchaProvider = 'recaptcha'
    ;(wrapper.vm as any).captchaFallbackProvider = 'recaptcha'
    await (wrapper.vm as any).saveCaptcha()

    expect(warningMock).toHaveBeenCalledWith('ServerConfigView.captchaFallbackDistinct')
    expect(setCaptchaConfigMock).not.toHaveBeenCalled()
  })

  it('enables minScore when recaptcha is used as fallback provider', async () => {
    const wrapper = mount(ServerConfigView)
    await flush()

    ;(wrapper.vm as any).captchaProvider = 'turnstile'
    ;(wrapper.vm as any).captchaFallbackProvider = 'recaptcha'
    await flush()

    expect((wrapper.vm as any).isRecaptchaScoreActive).toBe(true)
  })

  it('saves provider none as disabled captcha mode', async () => {
    const wrapper = mount(ServerConfigView)
    await flush()

    ;(wrapper.vm as any).captchaProvider = 'none'
    ;(wrapper.vm as any).captchaFallbackProvider = 'none'
    ;(wrapper.vm as any).captchaMinScore = 0.5
    ;(wrapper.vm as any).captchaTrustWindowMinutes = 15

    await (wrapper.vm as any).saveCaptcha()

    expect(setCaptchaConfigMock).toHaveBeenCalledWith({
      provider: 'none',
      fallbackProvider: 'none',
      minScore: 0.5,
      trustWindowMinutes: 15,
    })
  })

  it('loads trust window minutes from captcha config', async () => {
    const wrapper = mount(ServerConfigView)
    await flush()

    ;(wrapper.vm as any).activeNames = ['captcha']
    await flush()

    expect((wrapper.vm as any).captchaTrustWindowMinutes).toBe(30)
  })

  it('exposes provider card options including none, recaptcha, and turnstile', async () => {
    const wrapper = mount(ServerConfigView)
    await flush()

    const options = (wrapper.vm as any).captchaProviderOptions
    expect(options.map((item: any) => item.value)).toEqual(['none', 'recaptcha', 'turnstile'])
  })
})
