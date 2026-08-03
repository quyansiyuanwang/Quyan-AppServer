// @vitest-environment jsdom
import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { i18ns } from '@/locales'
import TrustedDeviceEntryView from '@/views/settings/TrustedDeviceEntryView.vue'

const ElButtonStub = defineComponent({
  name: 'ElButtonStub',
  emits: ['click'],
  template: `
    <button class="el-button-stub" @click="$emit('click')">
      <slot />
    </button>
  `,
})

describe('TrustedDeviceEntryView', () => {
  it('renders trusted-device title and description', () => {
    const wrapper = mount(TrustedDeviceEntryView, {
      global: {
        stubs: {
          'el-button': ElButtonStub,
        },
      },
    })

    expect(wrapper.text()).toContain(i18ns.t('twoFactor.trustedDevicesTitle'))
    expect(wrapper.text()).toContain(i18ns.t('twoFactor.trustedDevicesDesc'))
  })

  it('emits manage event when manage button is clicked', async () => {
    const wrapper = mount(TrustedDeviceEntryView, {
      global: {
        stubs: {
          'el-button': ElButtonStub,
        },
      },
    })

    await wrapper.find('.el-button-stub').trigger('click')

    expect(wrapper.emitted('manage')).toHaveLength(1)
  })
})
