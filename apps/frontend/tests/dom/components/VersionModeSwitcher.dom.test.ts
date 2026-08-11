// @vitest-environment jsdom

import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import VersionModeSwitcher from '@/components/common/VersionModeSwitcher.vue'

describe('VersionModeSwitcher', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('renders the legacy switch action when its exact HTTPS origin is configured', () => {
    vi.stubEnv('VITE_LEGACY_APP_ORIGIN', 'https://legacy.qysyw.cn')

    const wrapper = mount(VersionModeSwitcher)

    expect(wrapper.find('.item-version-mode').exists()).toBe(true)
  })

  it('does not expose a switch action for an unsafe configured origin', () => {
    vi.stubEnv('VITE_LEGACY_APP_ORIGIN', 'https://legacy.qysyw.cn/not-root')

    const wrapper = mount(VersionModeSwitcher)

    expect(wrapper.find('.item-version-mode').exists()).toBe(false)
  })
})
