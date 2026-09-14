// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'

const { assignDocument, push, currentSiteProfile, desktopState } = vi.hoisted(() => ({
  assignDocument: vi.fn(),
  push: vi.fn(),
  desktopState: { isDesktop: false },
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
  useIsDesktopStore: () => ({ useIsDesktop: () => ref(desktopState.isDesktop) }),
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
  siteProfileIds: ['public', 'account'],
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

vi.mock('@/stores/siteNavigationStore', () => ({
  useSiteNavigationStore: () => ({
    openInNewTab: true,
    recentSiteIds: [],
    setOpenInNewTab: vi.fn(),
    recordRecentSite: vi.fn(),
  }),
}))

vi.mock('sortablejs', () => ({ default: class Sortable {} }))
vi.mock('element-plus', () => ({ ElMessageBox: { confirm: vi.fn() } }))

import AsideMenu from '@/layouts/AsideMenu.vue'

const openWindow = vi.fn()
window.open = openWindow

const stubs = {
  'el-drawer': { template: '<section><slot /></section>' },
  'el-dialog': {
    props: ['modelValue', 'zIndex'],
    template:
      '<section class="unpin-confirmation-dialog" :data-z-index="zIndex"><slot /><slot name="footer" /></section>',
  },
  'el-icon': { template: '<span><slot /></span>' },
  'el-menu': { methods: { updateActiveIndex: vi.fn() }, template: '<nav><slot /></nav>' },
  'el-button': { template: '<button><slot /></button>' },
  NavMenuItems: { template: '<div><slot name="pinned" /></div>' },
  LanguageSwitcher: { template: '<div />' },
}

beforeEach(() => {
  desktopState.isDesktop = false
})

const mountDesktopMenu = async () => {
  desktopState.isDesktop = true
  const wrapper = mount(AsideMenu, {
    props: { showNavigation: false },
    global: { stubs },
  })
  ;(wrapper.vm as { openOverview: () => void }).openOverview()
  await wrapper.vm.$nextTick()
  return wrapper
}

const findOverviewSiteItem = (wrapper: ReturnType<typeof mount>, labelKey: string) =>
  wrapper.findAll('.overview-site-item').find((item) => item.text().includes(labelKey))

describe('AsideMenu mobile site switcher', () => {
  it('renders the unpin confirmation above the feature overview drawer', () => {
    const wrapper = mount(AsideMenu, {
      props: { showNavigation: false },
      global: { stubs },
    })

    expect(wrapper.find('.unpin-confirmation-dialog').attributes('data-z-index')).toBe('3001')
  })

  it('opens the site list from the header trigger even on the public mobile shell', async () => {
    const wrapper = mount(AsideMenu, {
      props: { showNavigation: false },
      global: { stubs },
    })

    ;(wrapper.vm as { openOverview: () => void }).openOverview()
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.mobile-site-switcher').exists()).toBe(true)
    expect(wrapper.text()).toContain('nav.siteAccount')

    await wrapper
      .findAll('.mobile-site-switcher__item')
      .find((item) => item.text().includes('nav.siteAccount'))!
      .trigger('click')

    expect(openWindow).toHaveBeenCalledWith(
      'https://account.qysyw.test:5173/overview',
      '_blank',
      'noopener,noreferrer',
    )
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

    expect(openWindow).toHaveBeenCalledWith(
      'https://www.qysyw.test:5173/home',
      '_blank',
      'noopener,noreferrer',
    )
  })
})

describe('AsideMenu desktop site context menu', () => {
  it('opens the site in the new tab when the left click preference is a new tab', async () => {
    openWindow.mockClear()
    assignDocument.mockClear()

    const wrapper = await mountDesktopMenu()

    await findOverviewSiteItem(wrapper, 'nav.siteAccount')!.trigger('click')

    expect(openWindow).toHaveBeenCalledWith(
      'https://account.qysyw.test:5173/overview',
      '_blank',
      'noopener,noreferrer',
    )
    expect(assignDocument).not.toHaveBeenCalled()
  })

  it('opens the site in the current page from the context menu, opposite to the left click', async () => {
    openWindow.mockClear()
    assignDocument.mockClear()

    const wrapper = await mountDesktopMenu()
    const accountItem = findOverviewSiteItem(wrapper, 'nav.siteAccount')!

    // 左键偏好为「新标签页」，菜单因此提供「在当前页打开」。
    await accountItem.trigger('contextmenu', { clientX: 48, clientY: 48 })
    await wrapper.vm.$nextTick()

    const menu = wrapper.find('.site-context-menu')
    expect(menu.exists()).toBe(true)
    expect(menu.text()).toContain('nav.openInCurrentPage')

    await menu.find('.route-context-menu__item').trigger('click')
    await wrapper.vm.$nextTick()

    expect(assignDocument).toHaveBeenCalledWith('https://account.qysyw.test:5173/overview')
    expect(openWindow).not.toHaveBeenCalled()
    expect(wrapper.find('.site-context-menu').exists()).toBe(false)
  })
})
