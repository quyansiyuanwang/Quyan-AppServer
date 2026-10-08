// @vitest-environment jsdom
import { defineComponent, ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useIamPolicyTools } from '@/views/management/ram-management/useIamPolicyTools'
import { useIamPolicyEditor } from '@/views/management/ram-management/useIamPolicyEditor'

const { validatePolicy, getIamActions } = vi.hoisted(() => ({
  validatePolicy: vi.fn(),
  getIamActions: vi.fn(),
}))
vi.mock('@/service/ramService', () => ({ ramService: { validatePolicy, getIamActions } }))
vi.mock('@/locales', () => ({ i18ns: { t: (key: string) => key } }))
let context: ReturnType<typeof useIamPolicyEditor> &
  ReturnType<typeof useIamPolicyTools> & {
    submitting: ReturnType<typeof ref<boolean>>
    canReadPolicies: ReturnType<typeof ref<boolean>>
  }
vi.mock('@/views/management/ram-management/context', () => ({
  useRamManagementContext: () => context,
}))
import RamIamPolicyEditor from '@/views/management/ram-management/components/RamIamPolicyEditor.vue'

const inputStub = defineComponent({
  props: ['modelValue', 'disabled'],
  emits: ['update:modelValue'],
  setup(_, { expose }) {
    const textarea = ref<HTMLTextAreaElement>()
    expose({ textarea })
    return { textarea }
  },
  template: `<textarea ref="textarea" :value="modelValue" :disabled="disabled" @input="$emit('update:modelValue', $event.target.value)" />`,
})
const alertStub = defineComponent({
  props: ['title'],
  template: '<div role="alert">{{ title }}</div>',
})
const buttonStub = defineComponent({
  props: ['disabled'],
  template: '<button :disabled="disabled"><slot /></button>',
})
const selectStub = defineComponent({
  emits: ['change'],
  template: `<select @change="$emit('change', $event.target.value)"><slot /></select>`,
})
const optionStub = defineComponent({
  props: ['value', 'label'],
  template: '<option :value="value">{{ label }}</option>',
})
const tagStub = defineComponent({ template: '<span><slot /></span>' })

describe('IAM policy editor controls and warnings', () => {
  beforeEach(() => vi.clearAllMocks())
  it('validates entered JSON, presents Deny and scope warnings, and clears them after an edit', async () => {
    context = {
      ...useIamPolicyEditor(),
      ...useIamPolicyTools(),
      submitting: ref(false),
      canReadPolicies: ref(false),
    }
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
  it('inserts catalog actions into the actual textarea selection and invalidates validation', async () => {
    getIamActions.mockResolvedValue(['alidns:AddDomainRecord'])
    context = {
      ...useIamPolicyEditor(),
      ...useIamPolicyTools(),
      submitting: ref(false),
      canReadPolicies: ref(true),
    }
    const wrapper = mount(RamIamPolicyEditor, {
      global: {
        stubs: {
          'el-input': inputStub,
          'el-select': selectStub,
          'el-option': optionStub,
          'el-alert': alertStub,
          'el-button': buttonStub,
          'el-tag': tagStub,
        },
      },
    })
    await flushPromises()
    expect(getIamActions).toHaveBeenCalled()
    const textarea = wrapper.get('textarea')
    const before = '{"Action":"replace-me"}'
    await textarea.setValue(before)
    const start = before.indexOf('replace-me')
    textarea.element.setSelectionRange(start, start + 'replace-me'.length)
    context.policyValidation.value = {
      valid: true,
      documentHash: 'old-hash',
      broadWildcard: false,
      document: { Version: '1', Statement: [{ Effect: 'Allow', Action: '*', Resource: '*' }] },
    }
    await wrapper.get('select').setValue('alidns:AddDomainRecord')
    await flushPromises()
    expect(context.policyDocumentText.value).toBe('{"Action":"alidns:AddDomainRecord"}')
    expect(textarea.element.value).toBe(context.policyDocumentText.value)
    expect(textarea.element.selectionStart).toBe(start + 'alidns:AddDomainRecord'.length)
    expect(textarea.element.selectionEnd).toBe(textarea.element.selectionStart)
    expect(context.policyValidation.value).toBeNull()
    expect(validatePolicy).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
