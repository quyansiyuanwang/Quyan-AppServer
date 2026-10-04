// @vitest-environment jsdom
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import OAuthScopeTreeSelector from '@/components/oauth/OAuthScopeTreeSelector.vue'
const TreeStub = defineComponent({
  props: ['data'],
  setup: () => ({ setCheckedKeys: vi.fn(), store: { _getAllNodes: () => [] } }),
  template: '<div />',
})
const scopes = [
  {
    scope: 'profile',
    category: 'identity',
    kind: 'identity' as const,
    riskLevel: 'normal' as const,
    grantable: true,
    legacy: false,
    labelKey: 'oauthScopes.scopes.profile.label',
    descriptionKey: 'oauthScopes.scopes.profile.description',
    categoryKey: 'oauthScopes.categories.identity',
  },
]
describe('OAuthScopeTreeSelector', () => {
  it('defaults undefined scope props to an empty catalog without throwing', async () => {
    const onError = vi.fn()
    const wrapper = mount(OAuthScopeTreeSelector, {
      props: { modelValue: ['profile'], scopes: undefined },
      global: { config: { errorHandler: onError }, stubs: { 'el-tree': TreeStub } },
    })
    await flushPromises()
    expect(wrapper.props('scopes')).toEqual([])
    expect((wrapper.vm as any).treeData).toEqual([])
    expect((wrapper.vm as any).highRiskCount).toBe(0)
    expect(onError).not.toHaveBeenCalled()
    wrapper.unmount()
  })
  it('builds permission categories and emits the grantable selection from a loaded catalog', async () => {
    const wrapper = mount(OAuthScopeTreeSelector, {
      props: { modelValue: [], scopes },
      global: { stubs: { 'el-tree': TreeStub } },
    })
    await flushPromises()
    expect((wrapper.vm as any).treeData[0].children[0].value).toBe('profile')
    ;(wrapper.vm as any).selectAllGrantable()
    expect(wrapper.emitted('update:modelValue')).toEqual([[['profile']]])
    wrapper.unmount()
  })
})
