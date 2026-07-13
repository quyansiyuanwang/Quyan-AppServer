import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

const {
  replaceMock,
  pushMock,
  bootstrapSessionMock,
  getQrLoginSessionContextMock,
  scanQrLoginMock,
  confirmQrLoginMock,
  elMessageSuccessMock,
  elMessageErrorMock,
  elMessageInfoMock,
  routeState,
} = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  pushMock: vi.fn(),
  bootstrapSessionMock: vi.fn(),
  getQrLoginSessionContextMock: vi.fn(),
  scanQrLoginMock: vi.fn(),
  confirmQrLoginMock: vi.fn(),
  elMessageSuccessMock: vi.fn(),
  elMessageErrorMock: vi.fn(),
  elMessageInfoMock: vi.fn(),
  routeState: {
    query: {
      sessionId: 'session-1',
      redirect: '/home',
    },
  },
}))

vi.mock('vue-router', () => ({
  useRoute: () => routeState,
  useRouter: () => ({
    replace: replaceMock,
    push: pushMock,
  }),
}))

vi.mock('@/locales', () => ({
  i18ns: {
    t: (key: string) => key,
  },
}))

vi.mock('@/service/socialAuthService', () => ({
  socialAuthService: {
    getQrLoginSessionContext: getQrLoginSessionContextMock,
    scanQrLogin: scanQrLoginMock,
    confirmQrLogin: confirmQrLoginMock,
  },
}))

vi.mock('@/service/authorizationService', () => ({
  authorizationService: {
    bootstrapSession: bootstrapSessionMock,
  },
}))

vi.mock('element-plus', () => ({
  ElMessage: {
    success: elMessageSuccessMock,
    error: elMessageErrorMock,
    info: elMessageInfoMock,
  },
}))

import QrApprovalView from '@/views/auth/QrApprovalView.vue'

const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

const mountView = () =>
  mount(QrApprovalView, {
    global: {
      stubs: {
        'el-button': {
          template: '<button @click="$emit(\'click\')"><slot /></button>',
        },
        'el-tag': {
          props: ['type'],
          template: '<span><slot /></span>',
        },
        'el-descriptions': {
          template: '<div><slot /></div>',
        },
        'el-descriptions-item': {
          props: ['label'],
          template: '<div><span>{{ label }}</span><slot /></div>',
        },
        'el-result': {
          props: ['title', 'subTitle'],
          template: '<div><div>{{ title }}</div><div>{{ subTitle }}</div></div>',
        },
      },
    },
  })

describe('QrApprovalView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    routeState.query = {
      sessionId: 'session-1',
      redirect: '/home',
    }

    bootstrapSessionMock.mockResolvedValue('user-1')
    getQrLoginSessionContextMock.mockResolvedValue({
      sessionId: 'session-1',
      status: 'pending',
      expiresIn: 120,
      createdAt: '2026-07-14T00:00:00.000Z',
      requestIp: '1.2.3.4',
      requestLocation: '测试地区',
      requestUserAgent: 'Mozilla/5.0',
      deviceSummary: 'Windows · Chrome',
      user: {
        id: 'user-1',
        username: 'tester',
        email: 'tester@example.com',
      },
    })
    scanQrLoginMock.mockResolvedValue({ status: 'scanned', expiresIn: 100 })
    confirmQrLoginMock.mockResolvedValue({ status: 'approved', expiresIn: 100 })
  })

  it('redirects unauthenticated user to login continuation', async () => {
    bootstrapSessionMock.mockResolvedValue(null)

    const wrapper = mountView()
    await flush()

    expect(wrapper.text()).toContain('loginOrRegisterPage.qrApprovalNeedLogin')
    await wrapper.get('button').trigger('click')

    expect(pushMock).toHaveBeenCalledWith({
      name: 'login',
      query: {
        redirect: '/auth/qr-approve?sessionId=session-1&redirect=%2Fhome',
      },
    })
  })

  it('approves qr login and keeps result state on page', async () => {
    const wrapper = mountView()
    await flush()

    const buttons = wrapper.findAll('button')
    await buttons[1].trigger('click')
    await flush()

    expect(scanQrLoginMock).toHaveBeenCalledWith('session-1')
    expect(confirmQrLoginMock).toHaveBeenCalledWith('session-1', true)
    expect(elMessageSuccessMock).toHaveBeenCalled()
    expect(wrapper.text()).toContain('已批准登录')
    expect(replaceMock).not.toHaveBeenCalled()
  })

  it('shows ended state when session is expired', async () => {
    getQrLoginSessionContextMock.mockResolvedValue({
      sessionId: 'session-1',
      status: 'expired',
      expiresIn: 0,
      createdAt: '2026-07-14T00:00:00.000Z',
    })

    const wrapper = mountView()
    await flush()

    expect(wrapper.text()).toContain('会话已过期')
    expect(wrapper.text()).toContain('返回')
  })
})
