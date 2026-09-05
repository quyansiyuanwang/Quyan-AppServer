// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

const { isDesktop } = vi.hoisted(() => ({ isDesktop: { __v_isRef: true, value: true } }))

vi.mock('@/composables/usePageDevice', () => ({ usePageDevice: () => ({ isDesktop }) }))
vi.mock('@/service/systemService', () => ({
  default: { getSystemStats: vi.fn(() => new Promise(() => undefined)) },
}))
vi.mock('@/locales', () => ({ i18ns: { t: (key: string) => key } }))
vi.mock('element-plus', () => ({ ElMessage: { error: vi.fn() } }))

import SystemStatsView from '@/views/system/SystemStatsView.vue'

const mountView = () =>
  mount(SystemStatsView, {
    global: {
      directives: { loading: {} },
      stubs: {
        'el-card': { template: '<article><slot /><slot name="header" /></article>' },
        'el-collapse': { template: '<section><slot /></section>' },
        'el-collapse-item': { template: '<section><slot /></section>' },
      },
    },
  })

describe('SystemStatsView layout', () => {
  it('uses the responsive grid container on desktop', () => {
    isDesktop.value = true
    const wrapper = mountView()

    expect(wrapper.find('.system-stats-page .system-stats-container').exists()).toBe(true)
    expect(wrapper.find('.system-stats-mobile-adapter').exists()).toBe(false)
  })

  it('uses the collapsed single-column adapter on mobile', () => {
    isDesktop.value = false
    const wrapper = mountView()

    expect(wrapper.find('.system-stats-mobile-adapter').exists()).toBe(true)
  })
})
