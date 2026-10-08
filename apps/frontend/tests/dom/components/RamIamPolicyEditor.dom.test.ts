// @vitest-environment jsdom
import { defineComponent, ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { useIamPolicyEditor } from '@/views/management/ram-management/useIamPolicyEditor'

const { validatePolicy } = vi.hoisted(() => ({ validatePolicy: vi.fn() }))
vi.mock('@/service/ramService', () => ({ ramService: { validatePolicy } }))
vi.mock('@/locales', () => ({ i18ns: { t: (key: string) => key } }))
let context: ReturnType<typeof useIamPolicyEditor> & { submitting: ReturnType<typeof ref<boolean>> }
vi.mock('@/views/management/ram-management/context', () => ({
  useRamManagementContext: () => context,
}))
import RamIamPolicyEditor from '@/views/management/ram-management/components/RamIamPolicyEditor.vue'

const inputStub = defineComponent({
  props: ['modelValue', 'disabled'],
  emits: ['update:modelValue'],
  template: `<textarea :value="modelValue" :disabled="disabled" @input="$emit('update:modelValue', $event.target.value)" />`,
})
const alertStub = defineComponent({
  props: ['title'],
  template: '<div role="alert">{{ title }}</div>',
})
const buttonStub = defineComponent({
  props: ['disabled'],
  template: '<button :disabled="disabled"><slot /></button>',
})
const tagStub = defineComponent({ template: '<span><slot /></span>' })

describe('IAM policy editor controls and warnings', () => {
  it('validates entered JSON, presents Deny and scope warnings, and clears them after an edit', async () => {
    context = { ...useIamPolicyEditor(), submitting: ref(false) }
    const wrapper = mount(RamIamPolicyEditor, {
      global: {
        stubs: {
          'el-input': inputStub,
          'el-alert': alertStub,
          'el-button': buttonStub,
          'el-tag': tagStub,
        },
      },
    })
    const document = { Version: '1', Statement: { Effect: 'Deny', Action: '*', Resource: '*' } }
    validatePolicy.mockResolvedValue({
      valid: true,
      document,
      documentHash: 'h1',
      broadWildcard: true,
    })
    await wrapper.get('textarea').setValue(JSON.stringify(document))
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(validatePolicy).toHaveBeenCalledWith(document)
    expect(wrapper.text()).toContain('RamManagement.policyValid')
    expect(wrapper.text()).toContain('RamManagement.iamDenyWarning')
    expect(wrapper.text()).toContain('RamManagement.iamWildcardWarning')
    await wrapper.get('textarea').setValue('{')
    expect(wrapper.text()).not.toContain('RamManagement.policyValid')
    expect(wrapper.text()).not.toContain('RamManagement.iamDenyWarning')
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('RamManagement.policyValidationFailed')
    context.submitting.value = true
    await flushPromises()
    expect(wrapper.get('textarea').attributes()).toHaveProperty('disabled')
    expect(wrapper.get('button').attributes()).toHaveProperty('disabled')
    wrapper.unmount()
  })
})
