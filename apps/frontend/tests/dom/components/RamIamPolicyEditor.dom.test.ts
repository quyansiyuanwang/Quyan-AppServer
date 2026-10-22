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
  beforeEach(() => {
    vi.clearAllMocks()
    getIamActions.mockResolvedValue([])
  })
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
    expect(wrapper.findComponent({ name: 'RamIamPolicyAiDraft' }).exists()).toBe(false)
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
    expect(wrapper.get('[data-test="json-mode"]').attributes()).not.toHaveProperty('disabled')
    await wrapper.get('[data-test="json-mode"]').trigger('click')
    expect(context.policyEditorMode.value).toBe('json')
    expect(JSON.parse(context.policyDocumentText.value).Statement[0]).toMatchObject({
      Action: [],
      Resource: [],
    })
    await wrapper.get('[data-test="validate-policy"]').trigger('click')
    await flushPromises()
    expect(context.policyValidation.value).toBeNull()
    wrapper.unmount()
  })
  it('does not enter visual mode after closing, resetting, or changing the source during diagnosis', async () => {
    for (const event of ['close', 'reset', 'edit'] as const) {
      context = {
        ...useIamPolicyEditor(),
        ...useIamPolicyTools(),
        submitting: ref(false),
        canReadPolicies: ref(false),
      }
      context.policyDocumentText.value = '{source}'
      let finish!: (value: object) => void
      diagnosePolicy.mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve
        }),
      )
      const wrapper = mount(RamIamPolicyEditor, {
        global: { stubs: { RamIamPolicyAiDraft: true, 'el-button': buttonStub } },
      })
      await wrapper.get('[data-test="visual-mode"]').trigger('click')
      if (event === 'close') wrapper.unmount()
      else if (event === 'reset') context.initializePolicyEditor()
      else context.policyDocumentText.value = '{newer}'
      finish({
        valid: true,
        diagnostics: [],
        documentHash: 'fixture',
        document: {
          Version: '1',
          Statement: [{ Effect: 'Allow', Action: ['quyan:ram:ReadUser'], Resource: ['*'] }],
        },
      })
      await flushPromises()
      expect(context.policyEditorMode.value).toBe('json')
      expect(context.policyValidation.value).toBeNull()
      expect(context.policyDocumentText.value).toBe(
        event === 'edit' ? '{newer}' : event === 'reset' ? '' : '{source}',
      )
      if (event !== 'close') wrapper.unmount()
    }
  })

  it('switches an unfinished visual condition back to JSON without losing edits or reusing validation', async () => {
    context = {
      ...useIamPolicyEditor(),
      ...useIamPolicyTools(),
      submitting: ref(false),
      canReadPolicies: ref(false),
    }
    const wrapper = mount(RamIamPolicyEditor, {
      global: {
        stubs: {
          'el-button': buttonStub,
          'el-input': inputStub,
          RamIamVisualStatement: defineComponent({
            name: 'RamIamVisualStatement',
            props: ['statement'],
            emits: ['update:statement'],
            template: '<div />',
          }),
        },
      },
    })
    await wrapper.get('[data-test="visual-mode"]').trigger('click')
    const row = wrapper.findComponent({ name: 'RamIamVisualStatement' })
    row.vm.$emit('update:statement', {
      ...row.props('statement'),
      sid: 'CurrentEdit',
      actions: ['quyan:ram:ReadUser'],
      resourcesText: 'acs:quyan:*:owner:user/user_1',
      conditions: [
        { operator: 'StringEquals', key: 'quyan:PrincipalId', valuesText: '"unfinished' },
      ],
    })
    await flushPromises()
    expect(context.visualPolicyValid.value).toBe(false)
    await wrapper.get('[data-test="json-mode"]').trigger('click')
    expect(wrapper.get('textarea').element.value).toContain('CurrentEdit')
    expect(context.policyDocumentText.value).toContain('user_1')
    expect(context.policyDocumentText.value).toContain('"unfinished')
    expect(() => JSON.parse(context.policyDocumentText.value)).toThrow()
    expect(context.policyValidation.value).toBeNull()
    wrapper.unmount()
  })

  it('loads and inserts static catalog Actions without account policy-read permission', async () => {
    getIamActions.mockResolvedValue(['quyan:ram:CreateUser'])
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
      canReadPolicies: ref(false),
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
  it('opens draft simulation from the current editor text and keeps edits from reusing old results', async () => {
    context = {
      ...useIamPolicyEditor(),
      ...useIamPolicyTools(),
      submitting: ref(false),
      canReadPolicies: ref(false),
    }
    context.policyDocumentText.value = '{draft-one'
    const wrapper = mount(RamIamPolicyEditor, {
      global: {
        stubs: {
          'el-input': inputStub,
          'el-button': buttonStub,
          'el-alert': alertStub,
        },
      },
    })
    await wrapper.get('[data-test="simulate-current-draft"]').trigger('click')
    expect(context.iamSimulationVisible.value).toBe(true)
    expect(context.iamSimulationUseDraft.value).toBe(true)
    expect(context.iamSimulationForm.documentText).toBe('{draft-one')
    context.iamSimulationResult.value = {
      decision: 'Allow',
      reason: 'matched-allow',
      matchedStatements: [],
    }
    await wrapper.get('textarea').setValue('{draft-two')
    expect(context.iamSimulationForm.documentText).toBe('{draft-two')
    expect(context.iamSimulationResult.value).toBeNull()
    wrapper.unmount()
  })
  it('shows denied catalog loads and retries without requiring policy-read permission', async () => {
    getIamActions.mockRejectedValueOnce(new Error('ExplicitDeny'))
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
          'el-select': selectStub,
          'el-option': optionStub,
        },
      },
    })
    await flushPromises()
    expect(context.iamActions.value).toEqual([])
    expect(wrapper.text()).toContain('RamManagement.iamActionsFailed')
    getIamActions.mockResolvedValueOnce(['quyan:ram:ReadUser'])
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'RamManagement.reloadIamActions')!
      .trigger('click')
    await flushPromises()
    expect(context.iamActions.value).toEqual(['quyan:ram:ReadUser'])
    expect(context.iamActionsFailed.value).toBe(false)
    wrapper.unmount()
  })
  it('coalesces Schema download clicks and does not download a late result after leaving', async () => {
    let resolve!: (schema: object) => void
    getPolicySchema.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done
      }),
    )
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
        },
      },
    })
    await flushPromises()
    const download = wrapper.get('[data-test="download-policy-schema"]')
    await download.trigger('click')
    await download.trigger('click')
    expect(getPolicySchema).toHaveBeenCalledOnce()
    expect(download.attributes()).toHaveProperty('disabled')
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    try {
      wrapper.unmount()
      resolve({ title: 'Schema' })
      await flushPromises()
      expect(click).not.toHaveBeenCalled()
    } finally {
      click.mockRestore()
    }
  })
})
