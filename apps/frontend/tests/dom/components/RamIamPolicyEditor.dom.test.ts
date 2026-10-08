// @vitest-environment jsdom
import { defineComponent, ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useIamPolicyTools } from '@/views/management/ram-management/useIamPolicyTools'
import { useIamPolicyEditor } from '@/views/management/ram-management/useIamPolicyEditor'

const { diagnosePolicy, getIamActions, getPolicySchema } = vi.hoisted(() => ({
  diagnosePolicy: vi.fn(),
  getIamActions: vi.fn(),
  getPolicySchema: vi.fn(),
}))
vi.mock('@/service/ramService', () => ({
  ramService: { diagnosePolicy, getIamActions, getPolicySchema },
}))
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
    diagnosePolicy.mockResolvedValue({
      valid: true,
      document: { ...document, Statement: [document.Statement] },
      diagnostics: [],
      documentHash: 'h1',
      broadWildcard: true,
    })
    await wrapper.get('textarea').setValue(JSON.stringify(document))
    await wrapper.get('[data-test="validate-policy"]').trigger('click')
    await flushPromises()
    expect(diagnosePolicy).toHaveBeenCalledWith(JSON.stringify(document))
    expect(wrapper.text()).toContain('RamManagement.policyValid')
    expect(wrapper.text()).toContain('RamManagement.iamDenyWarning')
    expect(wrapper.text()).toContain('RamManagement.iamWildcardWarning')
    diagnosePolicy.mockResolvedValueOnce({
      valid: false,
      diagnostics: [],
      delegation: 'not-evaluated',
    })
    await wrapper.get('textarea').setValue('{')
    expect(wrapper.text()).not.toContain('RamManagement.policyValid')
    expect(wrapper.text()).not.toContain('RamManagement.iamDenyWarning')
    await wrapper.get('[data-test="validate-policy"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('RamManagement.policyValidationFailed')
    context.submitting.value = true
    await flushPromises()
    expect(wrapper.get('textarea').attributes()).toHaveProperty('disabled')
    expect(wrapper.get('[data-test="validate-policy"]').attributes()).toHaveProperty('disabled')
    wrapper.unmount()
  })
  it('blocks the visual transition on invalid JSON and refuses saving an incomplete visual draft', async () => {
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
    context.policyDocumentText.value = '{'
    diagnosePolicy.mockResolvedValue({ valid: false, diagnostics: [] })
    await wrapper.get('[data-test="visual-mode"]').trigger('click')
    await flushPromises()
    expect(context.policyEditorMode.value).toBe('json')
    expect(context.policyDocumentText.value).toBe('{')
    context.policyDocumentText.value = ''
    await wrapper.get('[data-test="visual-mode"]').trigger('click')
    await flushPromises()
    expect(context.policyEditorMode.value).toBe('visual')
    expect(context.visualPolicyValid.value).toBe(false)
    diagnosePolicy.mockClear()
    await wrapper.get('[data-test="validate-policy"]').trigger('click')
    expect(diagnosePolicy).not.toHaveBeenCalled()
    expect(await context.getValidatedPolicyDocument()).toBeUndefined()
    expect(wrapper.get('[data-test="json-mode"]').attributes()).toHaveProperty('disabled')
    wrapper.unmount()
  })
  it('inserts catalog actions into the actual textarea selection and invalidates validation', async () => {
    getIamActions.mockResolvedValue(['quyan:ram:CreateUser'])
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
    await wrapper.get('select').setValue('quyan:ram:CreateUser')
    await flushPromises()
    expect(context.policyDocumentText.value).toBe('{"Action":"quyan:ram:CreateUser"}')
    expect(textarea.element.value).toBe(context.policyDocumentText.value)
    expect(textarea.element.selectionStart).toBe(start + 'quyan:ram:CreateUser'.length)
    expect(textarea.element.selectionEnd).toBe(textarea.element.selectionStart)
    expect(context.policyValidation.value).toBeNull()
    expect(diagnosePolicy).not.toHaveBeenCalled()
    wrapper.unmount()
  })
  it('groups diagnostics and focuses their original source position, clearing stale errors after editing', async () => {
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
    const diagnostic = {
      severity: 'error',
      code: 'json-syntax',
      path: '/Statement',
      line: 2,
      column: 2,
      messageKey: 'RamManagement.diagnosticMessages.json-syntax',
    }
    diagnosePolicy.mockResolvedValueOnce({
      valid: false,
      diagnostics: [diagnostic],
      delegation: 'not-evaluated',
    })
    await wrapper.get('textarea').setValue('{\n ]')
    await wrapper.get('[data-test="validate-policy"]').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('[data-severity]')).toHaveLength(4)
    expect(wrapper.text()).toContain('/Statement')
    await wrapper.get('[data-code="json-syntax"]').trigger('click')
    expect(wrapper.get('textarea').element.selectionStart).toBe(3)
    await wrapper.get('textarea').setValue('{}')
    expect(wrapper.find('[data-code="json-syntax"]').exists()).toBe(false)
    wrapper.unmount()
  })
  it('downloads the catalog Schema and reports download failures without changing policy text', async () => {
    context = {
      ...useIamPolicyEditor(),
      ...useIamPolicyTools(),
      submitting: ref(false),
      canReadPolicies: ref(true),
    }
    getIamActions.mockResolvedValue([])
    getPolicySchema.mockRejectedValueOnce(new Error('Denied'))
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
    await wrapper.get('textarea').setValue('original draft')
    const download = wrapper
      .findAll('button')
      .find((button) => button.text() === 'RamManagement.downloadPolicySchema')!
    await download.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('RamManagement.policySchemaFailed')
    expect(context.policyDocumentText.value).toBe('original draft')
    const create = vi.fn(() => 'blob:test-policy-schema'),
      revoke = vi.fn()
    const previousCreate = URL.createObjectURL,
      previousRevoke = URL.revokeObjectURL
    URL.createObjectURL = create
    URL.revokeObjectURL = revoke
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    try {
      getPolicySchema.mockResolvedValueOnce({ title: 'Policy schema' })
      await download.trigger('click')
      await flushPromises()
      expect(create).toHaveBeenCalledOnce()
      expect(click).toHaveBeenCalledOnce()
      expect(revoke).toHaveBeenCalledWith('blob:test-policy-schema')
      expect(wrapper.text()).not.toContain('RamManagement.policySchemaFailed')
    } finally {
      URL.createObjectURL = previousCreate
      URL.revokeObjectURL = previousRevoke
      click.mockRestore()
      wrapper.unmount()
    }
  })
})
