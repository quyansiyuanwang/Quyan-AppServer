// @vitest-environment jsdom
import { defineComponent } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const { generatePolicyDraft } = vi.hoisted(() => ({ generatePolicyDraft: vi.fn() }))
vi.mock('@/service/ramService', () => ({ ramService: { generatePolicyDraft } }))
vi.mock('@/locales', () => ({ i18ns: { t: (key: string) => key } }))
import RamIamPolicyAiDraft from '@/views/management/ram-management/components/RamIamPolicyAiDraft.vue'
const input = defineComponent({
  props: ['modelValue', 'disabled'],
  emits: ['update:modelValue'],
  template:
    '<input :value="modelValue" :disabled="disabled" @input="$emit(\'update:modelValue\', $event.target.value)" />',
})
const button = defineComponent({
  props: ['disabled'],
  template: '<button :disabled="disabled"><slot /></button>',
})
const checkbox = defineComponent({
  props: ['modelValue'],
  emits: ['update:modelValue'],
  template:
    '<input type="checkbox" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" />',
})
const document = {
  Version: '1',
  Statement: [
    { Effect: 'Allow', Action: 'quyan:ram:ReadUser', Resource: 'acs:quyan:*:owner:user/one' },
  ],
}
const response = {
  document,
  explanation: ['Only one user'],
  missingInformation: [],
  diagnostics: [],
  riskLevel: 'low',
  delegation: 'allowed',
}
const create = () =>
  mount(RamIamPolicyAiDraft, {
    props: { documentText: '' },
    global: {
      stubs: {
        'el-input': input,
        'el-button': button,
        'el-checkbox': checkbox,
        'el-form': { template: '<div><slot /></div>' },
        'el-form-item': { template: '<div><slot /></div>' },
        'el-alert': { props: ['title'], template: '<div>{{ title }}</div>' },
        RamIamPolicyDiagnostics: true,
      },
    },
  })
const fill = async (wrapper: ReturnType<typeof create>) => {
  await wrapper.get('[data-test="ai-instruction"]').setValue('Read user one')
  await wrapper.get('[data-test="ai-model"]').setValue('model-id')
  await wrapper.get('[data-test="ai-token-id"]').setValue('token-id')
}
beforeEach(() => vi.resetAllMocks())
describe('AI policy draft review', () => {
  it('only applies after explicit review, and never publishes through the draft workflow', async () => {
    generatePolicyDraft.mockResolvedValue(response)
    const wrapper = create()
    await fill(wrapper)
    await wrapper.get('[data-test="ai-generate"]').trigger('click')
    await flushPromises()
    expect(generatePolicyDraft).toHaveBeenCalledWith({
      instruction: 'Read user one',
      model: 'model-id',
      relayTokenId: 'token-id',
      policyKind: 'identity',
    })
    expect(wrapper.emitted('apply')).toBeUndefined()
    expect(wrapper.get('[data-test="ai-document"]').text()).toContain('acs:quyan:*:owner:user/one')
    await wrapper.get('[data-test="ai-apply"]').trigger('click')
    expect(wrapper.emitted('apply')).toEqual([[JSON.stringify(document, null, 2)]])
    wrapper.unmount()
  })
  it('keeps malformed draft diagnostics visible and prevents application', async () => {
    generatePolicyDraft.mockResolvedValue({
      ...response,
      document: undefined,
      diagnostics: [{ severity: 'error', code: 'json-syntax', path: '', line: 1, column: 1 }],
    })
    const wrapper = create()
    await fill(wrapper)
    await wrapper.get('[data-test="ai-generate"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="ai-result"]').exists()).toBe(true)
    expect(wrapper.get('[data-test="ai-apply"]').attributes('disabled')).toBeDefined()
    await wrapper.get('[data-test="ai-apply"]').trigger('click')
    expect(wrapper.emitted('apply')).toBeUndefined()
    wrapper.unmount()
  })
  it('invalidates old results when requirements or the current draft change and ignores late responses', async () => {
    let finish!: (value: typeof response) => void
    generatePolicyDraft.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const wrapper = create()
    await fill(wrapper)
    await wrapper.get('[data-test="ai-generate"]').trigger('click')
    await wrapper.get('[data-test="ai-instruction"]').setValue('New requirement')
    finish(response)
    await flushPromises()
    expect(wrapper.find('[data-test="ai-result"]').exists()).toBe(false)
    generatePolicyDraft.mockResolvedValue(response)
    await wrapper.get('[data-test="ai-generate"]').trigger('click')
    await flushPromises()
    await wrapper.setProps({ documentText: '{"Version":"1"}' })
    expect(wrapper.find('[data-test="ai-result"]').exists()).toBe(false)
    wrapper.unmount()
  })
  it('sends an existing draft only when selected and shows failure without stale output', async () => {
    const wrapper = create()
    await fill(wrapper)
    await wrapper.setProps({ documentText: '{invalid draft' })
    await wrapper.get('[data-test="ai-include-current"]').setValue(true)
    generatePolicyDraft.mockRejectedValue(new Error('fixture unavailable'))
    await wrapper.get('[data-test="ai-generate"]').trigger('click')
    await flushPromises()
    expect(generatePolicyDraft).toHaveBeenCalledWith(
      expect.objectContaining({ currentDocumentText: '{invalid draft' }),
    )
    expect(wrapper.find('[data-test="ai-failed"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="ai-result"]').exists()).toBe(false)
    wrapper.unmount()
  })
  it('does not issue requests with missing input or while disabled', async () => {
    const wrapper = create()
    await wrapper.get('[data-test="ai-generate"]').trigger('click')
    expect(generatePolicyDraft).not.toHaveBeenCalled()
    await fill(wrapper)
    await wrapper.setProps({ disabled: true })
    await wrapper.get('[data-test="ai-generate"]').trigger('click')
    expect(generatePolicyDraft).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
