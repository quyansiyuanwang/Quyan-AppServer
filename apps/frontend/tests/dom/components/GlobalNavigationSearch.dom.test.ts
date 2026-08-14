// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

const { push, open } = vi.hoisted(() => ({ push: vi.fn(), open: vi.fn() }))

vi.mock('@/locales', () => ({
  i18ns: {
    refer: { value: 'en' },
    t: (key: string) => key,
  },
}))

vi.mock('@/router', () => ({
  currentSiteProfile: {
    id: 'account',
    hostname: 'account.qysyw.test',
    canonicalOrigin: 'https://account.qysyw.test:5173',
    authOrigin: 'https://auth.qysyw.test:5173',
    defaultPath: '/overview',
    routeGroups: ['account', 'shared'],
    shell: 'application',
    app: 'account',
    kind: 'account',
    navigationGroup: 'account',
    accessPermissions: [],
    labelKey: 'nav.siteAccount',
  },
  default: {
    currentRoute: { value: { name: 'settingsProfile' } },
    push,
  },
}))

vi.mock('@/stores/permissionStore', () => ({
  usePermissionStore: () => ({ effectivePermissions: [] }),
}))

vi.mock('@/stores/sessionStore', () => ({
  useSessionStore: () => ({ isAuthenticated: true }),
}))

vi.mock('@/service/navigationService', () => ({ assignDocument: vi.fn() }))

import GlobalNavigationSearch from '@/components/navigation/GlobalNavigationSearch.vue'

const stubs = {
  'el-icon': { template: '<span><slot /></span>' },
  'el-popover': {
    props: ['visible'],
    template: '<section><slot name="reference" /><div v-if="visible"><slot /></div></section>',
  },
  'el-input': {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template:
      '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
  },
  'el-empty': { template: '<div />' },
}

describe('GlobalNavigationSearch', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    push.mockReset()
    open.mockReset()
  })

  it('focuses the direct topbar search from Ctrl+K and activates its selected command with Enter', async () => {
    vi.stubGlobal('open', open)
    const wrapper = mount(GlobalNavigationSearch, { global: { stubs } })

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))
    await wrapper.vm.$nextTick()

    const input = wrapper.find('input')
    expect(input.exists()).toBe(true)
    await input.setValue('documentation')
    await input.trigger('keydown', { key: 'Enter' })

    expect(open).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('removes the global shortcut listener when unmounted', async () => {
    const wrapper = mount(GlobalNavigationSearch, { global: { stubs } })
    wrapper.unmount()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))
    await Promise.resolve()

    expect(document.querySelector('input')).toBeNull()
  })
})
