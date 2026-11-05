// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { defineComponent, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import type { RelayRequestHeaderPolicy } from '@quyan/shared'
import RelaySystemHeaderPolicyEditor from '@/views/relay/relay-settings/components/RelaySystemHeaderPolicyEditor.vue'

const selectStub = defineComponent({
  name: 'ElSelect',
  props: ['modelValue', 'multiple', 'multipleLimit'],
  emits: ['update:modelValue'],
  template: '<div><slot /></div>',
})
const formStub = defineComponent({
  name: 'ElForm',
  props: ['disabled'],
  template: '<div><slot /></div>',
})
const optionStub = defineComponent({
  name: 'ElOption',
  props: ['value', 'label'],
  template: '<span>{{ label }}</span>',
})
const global = {
  stubs: { 'el-select': selectStub, 'el-form': formStub, 'el-option': optionStub },
}

describe('system request-header policy editor', () => {
  it('offers both system modes, without inheritance, and keeps both lists on mode changes', async () => {
    const policy = ref<RelayRequestHeaderPolicy>({
      mode: 'whitelist',
      allowlist: ['x-fixture-allowed'],
      blocklist: ['x-fixture-blocked'],
    })
    const host = defineComponent({
      components: { RelaySystemHeaderPolicyEditor },
      setup: () => ({ policy }),
      template: '<RelaySystemHeaderPolicyEditor v-model="policy" :disabled="false" />',
    })
    const wrapper = mount(host, { global })
    const [mode, allowlist, blocklist] = wrapper.findAllComponents(selectStub)
    expect(wrapper.findAllComponents(optionStub).map((option) => option.props('value'))).toEqual([
      'whitelist',
      'blacklist',
    ])
    expect(wrapper.text()).not.toContain('relay.systemRequestHeaderPolicy')
    mode!.vm.$emit('update:modelValue', 'blacklist')
    await wrapper.vm.$nextTick()
    expect(policy.value).toEqual({
      mode: 'blacklist',
      allowlist: ['x-fixture-allowed'],
      blocklist: ['x-fixture-blocked'],
    })
    allowlist!.vm.$emit('update:modelValue', ['x-sdk-fixture'])
    blocklist!.vm.$emit('update:modelValue', ['x-debug-fixture'])
    await wrapper.vm.$nextTick()
    mode!.vm.$emit('update:modelValue', 'whitelist')
    await wrapper.vm.$nextTick()
    expect(policy.value).toEqual({
      mode: 'whitelist',
      allowlist: ['x-sdk-fixture'],
      blocklist: ['x-debug-fixture'],
    })
    wrapper.unmount()
  })

  it('disables the fieldset and form while system configuration is unavailable or saving', async () => {
    const wrapper = mount(RelaySystemHeaderPolicyEditor, {
      props: {
        modelValue: { mode: 'whitelist', allowlist: [], blocklist: [] },
        disabled: true,
      },
      global,
    })
    expect((wrapper.get('fieldset').element as HTMLFieldSetElement).disabled).toBe(true)
    expect(wrapper.findComponent(formStub).props('disabled')).toBe(true)
    await wrapper.setProps({ disabled: false })
    expect((wrapper.get('fieldset').element as HTMLFieldSetElement).disabled).toBe(false)
    expect(wrapper.findComponent(formStub).props('disabled')).toBe(false)
    wrapper.unmount()
  })
})
