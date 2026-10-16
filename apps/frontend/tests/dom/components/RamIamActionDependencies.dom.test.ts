// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
vi.mock('@/locales', () => ({ i18ns: { t: (key: string) => key } }))
import View from '@/views/management/ram-management/components/RamIamActionDependencies.vue'
describe('IAM additional check guidance', () => {
  it('shows a separate generated-destination check and never emits an automatic grant', async () => {
    const actions = ['quyan:relay:DuplicateChannels'],
      view = mount(View, { props: { actions } })
    expect(view.get('[data-test="action-dependencies"]').element.tagName).toBe('DETAILS')
    expect(view.get('[data-scope="cross-resource"]').text()).toContain(
      'quyan:relay:CreateChannelCopy',
    )
    expect(view.text()).toContain('RamManagement.visualDependencyDestination')
    expect(view.text()).toContain('RamManagement.visualDependencyReserved')
    expect(view.text()).toContain('RamManagement.visualDependenciesHint')
    expect(view.findAll('button')).toHaveLength(0)
    expect(view.emitted()).toEqual({})
    expect(actions).toEqual(['quyan:relay:DuplicateChannels'])
    view.unmount()
  })
  it('reactively distinguishes source, same-resource and variant checks', async () => {
    const view = mount(View, { props: { actions: ['quyan:relay:CreateChannelCopy'] } })
    expect(view.text()).toContain('RamManagement.visualDependencySource')
    expect(view.text()).toContain('RamManagement.visualDependencyResolved')
    await view.setProps({ actions: ['quyan:system:error_report:UpdateErrorGroupStatus'] })
    expect(view.find('[data-scope="same-resource"]').exists()).toBe(true)
    expect(view.text()).toContain('quyan:system:error_report:GetErrorGroup')
    await view.setProps({ actions: ['quyan:remote_terminal:UpdateEntitlement'] })
    expect(view.find('[data-scope="conditional"]').exists()).toBe(true)
    expect(view.text()).toContain('quyan:remote_terminal:DeleteEntitlement')
    await view.setProps({ actions: ['quyan:ram:ReadUser'] })
    expect(view.find('[data-test="action-dependencies"]').exists()).toBe(false)
    view.unmount()
  })
})
