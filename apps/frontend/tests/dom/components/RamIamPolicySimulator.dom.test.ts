// @vitest-environment jsdom
import { defineComponent } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { useIamPolicyTools } from '@/views/management/ram-management/useIamPolicyTools'
const { simulatePolicy, getIamActions } = vi.hoisted(() => ({
  simulatePolicy: vi.fn(),
  getIamActions: vi.fn(),
}))
vi.mock('@/service/ramService', () => ({ ramService: { simulatePolicy, getIamActions } }))
vi.mock('@/locales', () => ({ i18ns: { t: (key: string) => key } }))
let context: ReturnType<typeof useIamPolicyTools>
vi.mock('@/views/management/ram-management/context', () => ({
  useRamManagementContext: () => context,
}))
import RamIamPolicySimulator from '@/views/management/ram-management/components/RamIamPolicySimulator.vue'
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
const alert = defineComponent({ props: ['title'], template: '<div role="alert">{{ title }}</div>' })
const drawer = defineComponent({ template: '<div><slot /><slot name="footer" /></div>' })

describe('IAM policy simulator interaction', () => {
  it('shows decisions and matched identifiers and clears them when inputs change', async () => {
    context = useIamPolicyTools()
    context.iamActions.value = ['quyan:ram:ReadUser']
    context.iamSimulationForm.action = 'quyan:ram:ReadUser'
    const wrapper = mount(RamIamPolicySimulator, {
      global: {
        stubs: { 'el-input': input, 'el-button': button, 'el-alert': alert, 'el-drawer': drawer },
      },
    })
    const inputs = wrapper.findAll('input')
    await inputs[0].setValue('principal-1')
    await inputs[1].setValue('*')
    simulatePolicy.mockResolvedValueOnce({
      decision: 'ExplicitDeny',
      reason: 'explicit-deny',
      matchedStatements: [{ effect: 'Deny', policyId: 'p1', versionId: 'v1', statementId: 's1' }],
    })
    await wrapper.findAll('button')[1].trigger('click')
    await flushPromises()
    expect(simulatePolicy).toHaveBeenCalledWith({
      principalId: 'principal-1',
      action: 'quyan:ram:ReadUser',
      resource: '*',
    })
    expect(wrapper.text()).toContain('ExplicitDeny')
    expect(wrapper.text()).toContain('p1 · v1 · s1')
    await inputs[0].setValue('principal-2')
    expect(wrapper.text()).not.toContain('ExplicitDeny')
    simulatePolicy.mockRejectedValueOnce(new Error('Permission denied'))
    await wrapper.findAll('button')[1].trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('RamManagement.iamSimulationFailed')
    expect(wrapper.text()).not.toContain('Allow')
    wrapper.unmount()
  })
  it('simulates raw draft text without publishing and discards results after edits or source changes', async () => {
    context = useIamPolicyTools()
    context.iamActions.value = ['quyan:ram:ReadUser']
    Object.assign(context.iamSimulationForm, {
      principalId: 'principal-1',
      action: 'quyan:ram:ReadUser',
      resource: '*',
      documentText: '{raw draft',
    })
    context.iamSimulationUseDraft.value = true
    const wrapper = mount(RamIamPolicySimulator, {
      global: {
        stubs: { 'el-input': input, 'el-button': button, 'el-alert': alert, 'el-drawer': drawer },
      },
    })
    simulatePolicy.mockResolvedValueOnce({
      decision: 'Allow',
      reason: 'matched-allow',
      matchedStatements: [{ policyId: 'simulation:draft', statementId: '0', effect: 'Allow' }],
    })
    await context.simulateIamPolicy()
    await flushPromises()
    expect(simulatePolicy).toHaveBeenCalledWith({
      principalId: 'principal-1',
      action: 'quyan:ram:ReadUser',
      resource: '*',
      documentText: '{raw draft',
    })
    expect(wrapper.text()).toContain('RamManagement.simulateDraftHint')
    expect(wrapper.text()).toContain('simulation:draft')
    await wrapper.get('[data-test="simulate-draft-text"]').setValue('{new draft')
    expect(context.iamSimulationResult.value).toBeNull()
    let finish!: (value: unknown) => void
    simulatePolicy.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const pending = context.simulateIamPolicy()
    context.iamSimulationUseDraft.value = false
    finish({ decision: 'Allow', reason: 'matched-allow', matchedStatements: [] })
    await pending
    expect(context.iamSimulationResult.value).toBeNull()
    context.resetIamSimulation()
    expect(context.iamSimulationForm.documentText).toBe('')
    expect(context.iamSimulationUseDraft.value).toBe(false)
    wrapper.unmount()
  })
})
