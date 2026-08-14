// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

const { openDocs, toggleTheme } = vi.hoisted(() => ({
  openDocs: vi.fn(),
  toggleTheme: vi.fn(),
}))

vi.mock('@/locales', () => ({
  i18ns: {
    refer: { value: 'zh-CN' },
    t: (key: string) => key,
  },
}))

vi.mock('@/stores/themeToggleStore', () => ({
  useThemeToggleStore: () => ({
    useIsDark: () => ({ value: false }),
    toggleTheme,
  }),
}))

vi.mock('@/stores/floatingWorkspaceStore', () => ({
  useFloatingWorkspaceStore: () => ({ openDocs }),
}))

vi.mock('@/router', () => ({
  currentSiteProfile: { id: 'account' },
  default: { hasRoute: vi.fn(() => true), push: vi.fn() },
}))

vi.mock('vue-router', () => ({ useRoute: () => ({ name: 'settingsPreferences' }) }))
vi.mock('@/router/routes', () => ({ resolveCanonicalRouteUrl: vi.fn() }))
vi.mock('@/service/navigationService', () => ({ assignDocument: vi.fn() }))
vi.mock('element-plus', () => ({ ElMessage: { info: vi.fn() } }))

import RightUtilitySidebar from '@/layouts/RightUtilitySidebar.vue'

const stubs = {
  'el-tooltip': { template: '<span><slot /></span>' },
  'el-icon': { template: '<span><slot /></span>' },
  'el-button': { template: '<button><slot /></button>' },
  'el-dialog': {
    props: ['modelValue'],
    template: '<section v-if="modelValue"><slot /><slot name="footer" /></section>',
  },
  LanguageSwitcher: { template: '<div />' },
}

describe('RightUtilitySidebar', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('scrolls the application main container instead of the browser window', async () => {
    const animationFrames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      animationFrames.push(callback)
      return animationFrames.length
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())

    const container = document.createElement('main')
    container.scrollTop = 320
    const wrapper = mount(RightUtilitySidebar, {
      props: { scrollContainer: container },
      global: { stubs },
    })

    await wrapper.findAll('.utility-sidebar__action')[3].trigger('click')

    expect(animationFrames).toHaveLength(1)
    animationFrames[0](0)
    animationFrames[1](120)
    expect(container.scrollTop).toBeGreaterThan(0)
    expect(container.scrollTop).toBeLessThan(320)
    animationFrames[2](600)
    expect(container.scrollTop).toBe(0)
  })

  it('opens the current route documentation in the resizable workspace', async () => {
    const wrapper = mount(RightUtilitySidebar, { global: { stubs } })

    await wrapper.findAll('.utility-sidebar__action')[0].trigger('click')

    expect(openDocs).toHaveBeenCalledWith('settingsPreferences')
  })
})
