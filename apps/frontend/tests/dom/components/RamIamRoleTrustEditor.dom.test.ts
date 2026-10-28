// @vitest-environment jsdom
import { defineComponent, ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const { diagnosePolicy, setRoleTrustPolicy, getPolicySchema, confirm, notice } = vi.hoisted(() => ({
  diagnosePolicy: vi.fn(),
  setRoleTrustPolicy: vi.fn(),
  getPolicySchema: vi.fn(),
  confirm: vi.fn(),
  notice: vi.fn(),
}))
vi.mock('@/service/ramService', () => ({
  ramService: { diagnosePolicy, setRoleTrustPolicy, getPolicySchema },
}))
vi.mock('@/locales', () => ({ i18ns: { t: (key: string) => key } }))
vi.mock('@/utils/elementPlusRuntime', () => ({ ElMessageBox: { confirm } }))
vi.mock('@/utils/requestErrorNotice', () => ({ showRequestErrorNotice: notice }))
import Editor from '@/views/management/ram-management/components/RamIamRoleTrustEditor.vue'
const input = defineComponent({
  props: ['modelValue', 'disabled'],
  emits: ['update:modelValue'],
  setup(_, { expose }) {
    const textarea = ref<HTMLTextAreaElement>()
    expose({ textarea })
    return { textarea }
  },
  template:
    '<textarea ref="textarea" :value="modelValue" :disabled="disabled" @input="$emit(\'update:modelValue\', $event.target.value)" />',
})
const button = defineComponent({
  props: ['disabled'],
  template: '<button :disabled="disabled"><slot /></button>',
})
const document = {
  Version: '1',
  Statement: [
    {
      Effect: 'Allow',
      Action: 'quyan:ram:AssumeRole',
      Principal: { RAM: ['acs:quyan::owner:user/child'] },
      Resource: ['acs:quyan:*:owner:role/one'],
    },
  ],
}
const role = {
  id: 'one',
  accountOwnerId: 'owner',
  name: 'Role one',
  permissions: [],
  trustPolicy: document,
  trustPolicyHash: 'a'.repeat(64),
  maxSessionDuration: 3600,
  status: 1,
  createdAt: '',
  updatedAt: '',
}
const create = () =>
  mount(Editor, {
    props: { role },
    global: {
      stubs: {
        'el-input': input,
        'el-button': button,
        'el-drawer': { template: '<div><slot /><slot name="footer" /></div>' },
        'el-alert': { props: ['title'], template: '<div>{{ title }}</div>' },
        RamIamPolicyDiagnostics: true,
      },
    },
  })
beforeEach(() => {
  vi.resetAllMocks()
  diagnosePolicy.mockResolvedValue({ valid: true, document, diagnostics: [] })
  confirm.mockResolvedValue('confirm')
  setRoleTrustPolicy.mockResolvedValue(role)
})
describe('role trust publication review', () => {
  it('diagnoses with the trust schema, requires confirmation and sends the current hash', async () => {
    const wrapper = create()
    await wrapper.get('[data-test="trust-publish"]').trigger('click')
    await flushPromises()
    expect(diagnosePolicy).toHaveBeenCalledWith(JSON.stringify(document, null, 2), 'trust')
    expect(confirm).toHaveBeenCalledOnce()
    expect(setRoleTrustPolicy).toHaveBeenCalledWith('one', {
      document,
      expectedDocumentHash: role.trustPolicyHash,
    })
    expect(wrapper.emitted('saved')).toEqual([[role]])
    expect(wrapper.emitted('close')).toBeDefined()
    wrapper.unmount()
  })
  it('never publishes ambiguous JSON or a diagnosis that omits Principal', async () => {
    const wrapper = create()
    await wrapper.get('[data-test="trust-text"]').setValue('{')
    diagnosePolicy.mockResolvedValueOnce({
      valid: false,
      diagnostics: [{ severity: 'error', code: 'json-syntax', path: '', line: 1, column: 1 }],
    })
    await wrapper.get('[data-test="trust-publish"]').trigger('click')
    await flushPromises()
    expect(setRoleTrustPolicy).not.toHaveBeenCalled()
    expect(confirm).not.toHaveBeenCalled()
    diagnosePolicy.mockResolvedValueOnce({
      valid: true,
      diagnostics: [],
      document: {
        Version: '1',
        Statement: [{ Effect: 'Allow', Action: 'quyan:ram:AssumeRole', Resource: '*' }],
      },
    })
    await wrapper.get('[data-test="trust-publish"]').trigger('click')
    await flushPromises()
    expect(setRoleTrustPolicy).not.toHaveBeenCalled()
    wrapper.unmount()
  })
  it('invalidates pending diagnosis and confirmed publication when the text changes', async () => {
    const wrapper = create()
    let finish!: (value: unknown) => void
    diagnosePolicy.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    await wrapper.get('[data-test="trust-publish"]').trigger('click')
    await wrapper.get('[data-test="trust-text"]').setValue('{changed')
    finish({ valid: true, document, diagnostics: [] })
    await flushPromises()
    expect(setRoleTrustPolicy).not.toHaveBeenCalled()
    confirm.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    await wrapper.get('[data-test="trust-publish"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-test="trust-text"]').setValue('{changed again')
    finish('confirm')
    await flushPromises()
    expect(setRoleTrustPolicy).not.toHaveBeenCalled()
    wrapper.unmount()
  })
  it('keeps a denied or conflicted publication visible for review', async () => {
    const wrapper = create()
    setRoleTrustPolicy.mockRejectedValueOnce(new Error('fixture conflict'))
    await wrapper.get('[data-test="trust-publish"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('RamManagement.trustEditorFailed')
    expect(notice).toHaveBeenCalled()
    expect(wrapper.emitted('close')).toBeUndefined()
    wrapper.unmount()
  })
  it('uses the trust schema for downloads without publishing or exposing AI drafting', async () => {
    const wrapper = create()
    getPolicySchema.mockRejectedValueOnce(new Error('fixture denied'))
    await wrapper.get('[data-test="trust-schema"]').trigger('click')
    await flushPromises()
    expect(getPolicySchema).toHaveBeenCalledWith('trust')
    expect(wrapper.findComponent({ name: 'RamIamPolicyAiDraft' }).exists()).toBe(false)
    expect(setRoleTrustPolicy).not.toHaveBeenCalled()
    expect(JSON.parse(wrapper.get('[data-test="trust-text"]').element.value)).toEqual(document)
    wrapper.unmount()
  })
})
