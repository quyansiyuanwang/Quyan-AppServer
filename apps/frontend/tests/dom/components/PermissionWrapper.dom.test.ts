// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { hasPermissionMock } = vi.hoisted(() => ({
  hasPermissionMock: vi.fn<(permission: string) => boolean>(),
}))

vi.mock('@/stores/permissionStore', () => ({
  usePermissionStore: () => ({
    hasPermission: hasPermissionMock,
  }),
}))

import PermissionWrapper from '@/components/common/PermissionWrapper.vue'

describe('PermissionWrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders default slot when permission requirements are satisfied', () => {
    hasPermissionMock.mockImplementation((permission) => permission === 'user:read')

    const wrapper = mount(PermissionWrapper, {
      props: {
        require: ['user:read'],
        anyRequire: ['user:read', 'group:read'],
      },
      slots: {
        default: '<button class="allowed-btn">allowed</button>',
      },
    })

    expect(wrapper.find('.allowed-btn').exists()).toBe(true)
  })

  it('renders fallback slot in hide mode when permission denied', () => {
    hasPermissionMock.mockReturnValue(false)

    const wrapper = mount(PermissionWrapper, {
      props: {
        require: 'user:read',
        mode: 'hide',
      },
      slots: {
        default: '<button class="allowed-btn">allowed</button>',
        fallback: '<div class="fallback-text">denied</div>',
      },
    })

    expect(wrapper.find('.allowed-btn').exists()).toBe(false)
    expect(wrapper.find('.fallback-text').exists()).toBe(true)
  })

  it('renders empty output in hide mode when fallback slot is absent', () => {
    hasPermissionMock.mockReturnValue(false)

    const wrapper = mount(PermissionWrapper, {
      props: {
        require: 'user:read',
        mode: 'hide',
      },
      slots: {
        default: '<button class="allowed-btn">allowed</button>',
      },
    })

    expect(wrapper.find('.allowed-btn').exists()).toBe(false)
    expect(wrapper.text()).toBe('')
  })

  it('renders nothing when denied and mode value is unsupported', () => {
    hasPermissionMock.mockReturnValue(false)

    const wrapper = mount(PermissionWrapper, {
      props: {
        require: 'user:read',
        mode: 'none' as any,
      },
      slots: {
        default: '<button class="allowed-btn">allowed</button>',
        fallback: '<div class="fallback-text">denied</div>',
      },
    })

    expect(wrapper.find('.allowed-btn').exists()).toBe(false)
    expect(wrapper.find('.fallback-text').exists()).toBe(false)
    expect(wrapper.text()).toBe('')
  })

  it('renders disabled clone of default vnode in disabled mode', () => {
    hasPermissionMock.mockReturnValue(false)

    const wrapper = mount(PermissionWrapper, {
      props: {
        require: 'user:read',
        mode: 'disabled',
      },
      slots: {
        default: '<button class="target-btn">operate</button>',
      },
    })

    const button = wrapper.find('.target-btn')
    expect(button.exists()).toBe(true)
    expect(button.attributes('disabled')).toBeDefined()
  })

  it('renders nothing in disabled mode when default slot has no cloneable vnode', () => {
    hasPermissionMock.mockReturnValue(false)

    const wrapper = mount(PermissionWrapper, {
      props: {
        require: 'user:read',
        mode: 'disabled',
      },
      slots: {
        default: 'plain text only',
      },
    })

    expect(wrapper.find('.target-btn').exists()).toBe(false)
    expect(wrapper.text()).toBe('')
  })

  it('returns null disabled vnode when default slot is completely missing', () => {
    hasPermissionMock.mockReturnValue(false)

    const wrapper = mount(PermissionWrapper, {
      props: {
        require: 'user:read',
        mode: 'disabled',
      },
    })

    expect(wrapper.text()).toBe('')
  })
})
