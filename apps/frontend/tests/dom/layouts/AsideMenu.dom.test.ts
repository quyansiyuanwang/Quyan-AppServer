// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'

const { assignDocument, push, currentSiteProfile } = vi.hoisted(() => ({
  assignDocument: vi.fn(),
  push: vi.fn(),
  currentSiteProfile: {
    id: 'public',
    hostname: 'www.qysyw.test',
    canonicalOrigin: 'https://www.qysyw.test:5173',
    authOrigin: 'https://auth.qysyw.test:5173',
    defaultPath: '/home',
    routeGroups: ['public', 'shared'],
    shell: 'public',
    app: 'public',
    kind: 'public',
    navigationGroup: 'public',
    accessPermissions: [],
    labelKey: 'nav.sitePublic',
    deploymentId: 'local',
  },
}))

vi.mock('@/locales', () => ({
  i18ns: { refer: { value: 'zh-CN' }, t: (key: string) => key },
}))

vi.mock('@/router', () => ({
  currentSiteProfile,
  default: {
    currentRoute: { value: { name: 'home' } },
    hasRoute: vi.fn(() => true),
    push,
    resolve: vi.fn(() => ({ href: '/home' })),
  },
}))

vi.mock('@/stores/isDesktopStore', () => ({
  useIsDesktopStore: () => ({ useIsDesktop: () => ref(false) }),
}))

vi.mock('@/stores/permissionStore', () => ({
  usePermissionStore: () => ({
    effectivePermissions: [],
    hasPermission: () => false,
    hasAnyPermission: () => false,
  }),
}))

vi.mock('@/stores/themeToggleStore', () => ({
  useThemeToggleStore: () => ({ useIsDark: () => ref(false), toggleTheme: vi.fn() }),
}))

vi.mock('@/service/navigationService', () => ({ assignDocument }))
vi.mock('@/router/routes', () => ({ resolveCanonicalRouteUrl: vi.fn() }))
vi.mock('@/config/site-registry', () => ({
  getAccessibleSiteProfiles: () => [
    currentSiteProfile,
    {
      ...currentSiteProfile,
      id: 'account',
      hostname: 'account.qysyw.test',
      canonicalOrigin: 'https://account.qysyw.test:5173',
      defaultPath: '/overview',
      routeGroups: ['account', 'shared'],
      shell: 'application',
      app: 'account',
      kind: 'account',
      navigationGroup: 'account',
      labelKey: 'nav.siteAccount',
    },
  ],
}))

vi.mock('sortablejs', () => ({ default: class Sortable {} }))
vi.mock('element-plus', () => ({ ElMessageBox: { confirm: vi.fn() } }))

import AsideMenu from '@/layouts/AsideMenu.vue'

const stubs = {
  'el-drawer': { template: '<section><slot /></section>' },
  'el-dialog': {
    props: ['modelValue', 'zIndex'],
    template: '<section class="unpin-confirmation-dialog" :data-z-index="zIndex"><slot /><slot name="footer" /></section>',
  },
  'el-icon': { template: '<span><slot /></span>' },
  'el-menu': { methods: { updateActiveIndex: vi.fn() }, template: '<nav><slot /></nav>' },
  'el-button': { template: '<button><slot /></button>' },
  NavMenuItems: { template: '<div><slot name="pinned" /></div>' },
  LanguageSwitcher: { template: '<div />' },
}

describe('AsideMenu mobile site switcher', () => {
  it('renders the unpin confirmation above the feature overview drawer', () => {
    const wrapper = mount(AsideMenu, {
      props: { showNavigation: false },
      global: { stubs },
    })

    expect(wrapper.find('.unpin-confirmation-dialog').attributes('data-z-index')).toBe('3001')
  })

  it('opens the site switcher from the header trigger even on the public mobile shell', async () => {
    const wrapper = mount(AsideMenu, {
      props: { showNavigation: false },
      global: { stubs },
    })

    ;(wrapper.vm as { openOverview: () => void }).openOverview()
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.mobile-site-switcher').exists()).toBe(true)
    expect(wrapper.text()).toContain('nav.siteAccount')

    await wrapper.findAll('.mobile-site-switcher__item').find((item) => item.text().includes('nav.siteAccount'))!.trigger('click')

    expect(assignDocument).toHaveBeenCalledWith('https://account.qysyw.test:5173/overview')
  })

  it('keeps the current site available as an openable destination', async () => {
    const wrapper = mount(AsideMenu, {
      props: { showNavigation: false },
      global: { stubs },
    })

    ;(wrapper.vm as { openOverview: () => void }).openOverview()
    await wrapper.vm.$nextTick()

    const currentSite = wrapper
      .findAll('.mobile-site-switcher__item')
      .find((item) => item.text().includes('nav.sitePublic'))

    expect(currentSite?.attributes('disabled')).toBeUndefined()
    await currentSite?.trigger('click')

    expect(assignDocument).toHaveBeenCalledWith('https://www.qysyw.test:5173/home')
  })
})
