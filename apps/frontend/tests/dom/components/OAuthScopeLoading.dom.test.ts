// @vitest-environment jsdom
import { defineComponent, ref } from 'vue'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '@/locales'
const mocks = vi.hoisted(() => ({
  scopes: vi.fn(),
  create: vi.fn(),
  list: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}))
vi.mock('@/service/oauthClientService', () => ({
  OAuthClientService: {
    getInstance: () => ({
      getOAuthScopes: mocks.scopes,
      getOAuthClients: mocks.list,
      listSystemClients: mocks.list,
      createOAuthClient: mocks.create,
      createSystemClient: mocks.create,
    }),
  },
}))
vi.mock('@/service/authCenterClientService', () => ({
  AuthCenterClientService: {
    getInstance: () => ({ getAuthCenterClients: mocks.list, createAuthCenterClient: mocks.create }),
  },
}))
vi.mock('@/composables/usePageDevice', () => ({ usePageDevice: () => ({ isDesktop: ref(true) }) }))
vi.mock('@/utils/elementPlusRuntime', () => ({
  ElMessage: { warning: mocks.warning, error: mocks.error, success: vi.fn() },
  ElMessageBox: { confirm: vi.fn() },
}))
import OAuthClientManagementView from '@/views/settings/OAuthClientManagementView.vue'
import AuthCenterClientManagementView from '@/views/settings/AuthCenterClientManagementView.vue'
import SystemOAuthClientManagementView from '@/views/settings/SystemOAuthClientManagementView.vue'
import ClientIntegrationGuide from '@/components/oauth/ClientIntegrationGuide.vue'
const scope = {
  scope: 'profile',
  category: 'identity',
  kind: 'identity',
  riskLevel: 'normal',
  grantable: true,
  legacy: false,
  isNew: false,
  labelKey: 'oauthScopes.scopes.profile.label',
  descriptionKey: 'oauthScopes.scopes.profile.description',
  categoryKey: 'oauthScopes.categories.identity',
}
const ScopeStub = defineComponent({
  name: 'OAuthScopeTreeSelector',
  props: ['scopes', 'modelValue'],
  template: '<div class="scope-selector" />',
})
const FormStub = defineComponent({
  setup: () => ({ validate: vi.fn().mockResolvedValue(true) }),
  template: '<div><slot /></div>',
})
const ButtonStub = defineComponent({
  props: ['disabled', 'loading'],
  emits: ['click'],
  template: `<button :disabled="disabled || loading" @click="$emit('click')"><slot /></button>`,
})
let wrapper: VueWrapper
beforeEach(() => {
  vi.resetAllMocks()
  mocks.list.mockResolvedValue({ data: [] })
  mocks.scopes.mockRejectedValue(new Error('catalog unavailable'))
  mocks.create.mockResolvedValue({ data: {} })
})
afterEach(() => wrapper?.unmount())
describe.each([
  { name: 'OAuth', component: OAuthClientManagementView, guide: true },
  { name: 'Auth Center', component: AuthCenterClientManagementView, guide: true },
  { name: 'System OAuth', component: SystemOAuthClientManagementView, guide: false },
])('$name scope integration', ({ component, guide }) => {
  it('passes arrays on failure, blocks submission, and retries successfully', async () => {
    wrapper = mount(component, {
      global: {
        plugins: [i18n],
        stubs: {
          OAuthScopeTreeSelector: ScopeStub,
          'el-table-column': defineComponent({ template: '<div />' }),
          'el-dialog': defineComponent({
            props: ['modelValue'],
            template: '<div v-if="modelValue"><slot /><slot name="footer" /></div>',
          }),
          'el-form': FormStub,
          'el-button': ButtonStub,
        },
      },
    })
    await flushPromises()
    const vm = wrapper.vm as any
    vm.openCreateDialog()
    vm.form.name = 'Test integration'
    vm.form.redirectUris = ['https://example.test/callback']
    vm.form.scopes = ['profile']
    vm.form.clientId = 'test-system-client'
    await flushPromises()
    const selectors = wrapper.findAllComponents(ScopeStub)
    expect(selectors.length).toBeGreaterThan(0)
    for (const selector of selectors) expect(selector.props('scopes')).toEqual([])
    expect(vm.scopeCatalogReady).toBe(false)
    await expect(vm.handleSubmit()).resolves.toBeUndefined()
    expect(mocks.create).not.toHaveBeenCalled()
    expect(wrapper.findComponent(ClientIntegrationGuide).exists()).toBe(guide)
    mocks.scopes.mockResolvedValueOnce({ scopes: [scope] })
    await vm.loadScopeCatalog()
    await flushPromises()
    expect(vm.scopeCatalogReady).toBe(true)
    expect(wrapper.findComponent(ScopeStub).props('scopes')).toEqual([scope])
    await vm.handleSubmit()
    expect(mocks.create).toHaveBeenCalledTimes(1)
  })
})
