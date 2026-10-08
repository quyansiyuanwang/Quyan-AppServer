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
    context.iamActions.value = ['alidns:DescribeDomains']
    context.iamSimulationForm.action = 'alidns:DescribeDomains'
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
      action: 'alidns:DescribeDomains',
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
})
