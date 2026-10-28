// @vitest-environment jsdom
import { defineComponent } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import type { IamPolicyDocument } from '@quyan/shared'
vi.mock('@/locales', () => ({ i18ns: { t: (key: string) => key } }))
import RamIamVisualPolicyBuilder from '@/views/management/ram-management/components/RamIamVisualPolicyBuilder.vue'
const input = defineComponent({
  props: ['modelValue', 'disabled', 'type'],
  emits: ['update:modelValue'],
  template:
    '<textarea :value="modelValue" :disabled="disabled" @input="$emit(\'update:modelValue\', $event.target.value)" />',
})
const select = defineComponent({
  props: ['modelValue', 'multiple', 'disabled'],
  emits: ['update:modelValue', 'change'],
  setup(_, { emit }) {
    return {
      change: (event: Event) => {
        const target = event.target as HTMLSelectElement
        const value = target.multiple
          ? [...target.selectedOptions].map((option) => option.value)
          : target.value
        emit('update:modelValue', value)
        emit('change', value)
      },
    }
  },
  template:
    '<select :multiple="multiple" :value="modelValue" :disabled="disabled" @change="change"><slot /></select>',
})
const option = defineComponent({
  props: ['value', 'label'],
  template: '<option :value="value">{{ label }}</option>',
})
const button = defineComponent({
  props: ['disabled'],
  template: '<button :disabled="disabled"><slot /></button>',
})
const alert = defineComponent({ props: ['title'], template: '<p role="alert">{{ title }}</p>' })
const stubs = {
  'el-input': input,
  'el-select': select,
  'el-option': option,
  'el-button': button,
  'el-alert': alert,
}
const document: IamPolicyDocument = {
  Version: '1',
  Statement: {
    Effect: 'Allow',
    Action: 'quyan:ram:ReadUser',
    Resource: 'acs:quyan:*:owner:user/first',
  },
}
describe('visual IAM builder interactions', () => {
  it('keeps a single draft, emits ARN edits and blocks invalid JSON conditions', async () => {
    const wrapper = mount(RamIamVisualPolicyBuilder, {
      props: { document, accountOwnerId: 'owner', disabled: false },
      global: { stubs },
    })
    await wrapper
      .get('textarea[aria-label="RamManagement.visualResources"]')
      .setValue('acs:quyan:*:owner:user/second')
    await flushPromises()
    const latest = wrapper.emitted('document')!.at(-1)![0] as IamPolicyDocument
    expect((latest.Statement as Array<{ Resource: string[] }>)[0]?.Resource).toEqual([
      'acs:quyan:*:owner:user/second',
    ])
    await wrapper.get('[data-test="add-condition"]').trigger('click')
    await flushPromises()
    expect(wrapper.emitted('validity')!.at(-1)).toEqual([false])
    await wrapper
      .get('textarea[aria-label="RamManagement.visualConditionValues"]')
      .setValue('"203.0.113.0/24"')
    await flushPromises()
    expect(wrapper.emitted('validity')!.at(-1)).toEqual([true])
    await wrapper.get('textarea[aria-label="RamManagement.visualConditionValues"]').setValue('{')
    await flushPromises()
    expect(wrapper.emitted('validity')!.at(-1)).toEqual([false])
    await wrapper.setProps({ disabled: true })
    expect(wrapper.get('[data-test="add-statement"]').attributes()).toHaveProperty('disabled')
    wrapper.unmount()
  })
  it('does not construct a template without trusted account information and never defaults to all resources', async () => {
    const wrapper = mount(RamIamVisualPolicyBuilder, {
      props: { accountOwnerId: '', disabled: false },
      global: { stubs },
    })
    expect(wrapper.emitted('validity')!.at(-1)).toEqual([false])
    expect(wrapper.emitted('document')).toBeUndefined()
    expect(wrapper.get('[data-test="account-scope"]').attributes()).toHaveProperty('disabled')
    expect(wrapper.get('textarea[aria-label="RamManagement.visualResources"]').element.value).toBe(
      '',
    )
    wrapper.unmount()
  })
})
