// @vitest-environment jsdom
import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ElAlert, ElButton, ElCard, ElEmpty, ElSkeleton, ElTag } from 'element-plus'
import type { OAuthAuthorizationPreview } from '@/service/oauthAuthorizationService'

const mocks = vi.hoisted(() => ({
  preview: vi.fn(),
  decide: vi.fn(),
  session: vi.fn(),
  replace: vi.fn(),
  assign: vi.fn(),
  route: {
    fullPath: '/oauth/authorize',
    query: {
      response_type: 'code',
      client_id: 'test-client',
      redirect_uri: 'http://127.0.0.1/callback',
      state: 'test-state',
    },
  },
}))
vi.mock('vue-router', () => ({
  useRoute: () => mocks.route,
  useRouter: () => ({ replace: mocks.replace }),
}))
vi.mock('@/service/sessionCoordinator', () => ({
  sessionCoordinator: { ensureSession: mocks.session },
}))
vi.mock('@/stores/request', () => ({ getAccessToken: () => 'test-session' }))
vi.mock('@/service/navigationService', () => ({ assignDocument: mocks.assign }))
vi.mock('@/service/oauthAuthorizationService', () => ({
  OAuthAuthorizationFrontendService: {
    getInstance: () => ({ getPreview: mocks.preview, decide: mocks.decide }),
  },
}))
vi.mock('@/composables/usePageDevice', () => ({ usePageDevice: () => ({ isDesktop: true }) }))
vi.mock('@/utils/elementPlusRuntime', () => ({ ElMessage: { error: vi.fn() } }))
vi.mock('@/locales', () => ({ i18ns: { locale: 'en', t: (key: string) => key } }))
vi.mock('@/constant/permission-meta', () => ({
  getPermissionLabel: (key: string) => key,
  getPermissionTooltip: (key: string) => key,
}))
vi.mock('@/views/management/permission-tree', () => ({
  getPermissionCategoryTranslationKey: (key: string) => key,
}))
import OAuthAuthorizeView from '@/views/auth/OAuthAuthorizeView.vue'

function preview(): OAuthAuthorizationPreview {
  return {
    client: {
      clientId: 'test-client',
      name: 'Long test client'.repeat(10),
      description: 'Test description',
    },
    redirectUri: 'http://127.0.0.1/callback',
    requireConsent: true,
    requestedScopes: ['test:scope'],
    missingScopes: ['test:scope'],
    previouslyGrantedScopes: [],
    unavailableScopes: [],
    scopeDetails: [
      {
        scope: 'test:scope',
        category: 'general',
        riskLevel: 'high',
        labelKey: 'test.label',
        descriptionKey: 'test.description',
        isNew: true,
        grantable: true,
      },
    ],
  }
}
const render = () =>
  mount(OAuthAuthorizeView, {
    global: {
      stubs: { 'el-button': false },
      components: { ElAlert, ElButton, ElCard, ElEmpty, ElSkeleton, ElTag },
    },
  })

describe('OAuth consent layout and decisions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.session.mockResolvedValue('test-session')
    mocks.preview.mockResolvedValue({ data: preview() })
    mocks.decide.mockResolvedValue({
      data: { redirectTo: 'http://127.0.0.1/callback?code=test-code' },
    })
  })
  it('renders all scope information inline without a fixed-column table', async () => {
    const wrapper = render()
    await flushPromises()
    const item = wrapper.get('.oauth-scope-item')
    for (const text of [
      'test.label',
      'test.description',
      'test:scope',
      'oauthAuthorize.highRisk',
      'oauthAuthorize.new',
    ])
      expect(item.text()).toContain(text)
    expect(wrapper.find('table').exists()).toBe(false)
    wrapper.unmount()
  })
  it('preserves approval payload and backend-controlled callback', async () => {
    const wrapper = render()
    await flushPromises()
    await wrapper.get('.el-button--primary').trigger('click')
    await flushPromises()
    expect(mocks.decide).toHaveBeenCalledWith(expect.objectContaining(mocks.route.query), true)
    expect(mocks.assign).toHaveBeenCalledWith('http://127.0.0.1/callback?code=test-code')
    wrapper.unmount()
  })
  it('blocks approval for unavailable scopes but allows denial', async () => {
    const data = preview()
    data.unavailableScopes = ['test:scope']
    data.scopeDetails[0]!.grantable = false
    mocks.preview.mockResolvedValue({ data })
    const wrapper = render()
    await flushPromises()
    expect(wrapper.get('.el-button--primary').attributes('disabled')).toBeDefined()
    expect(wrapper.get('.oauth-scope-item').text()).toContain('oauthAuthorize.unavailable')
    await wrapper.get('.oauth-authorize-actions button').trigger('click')
    await flushPromises()
    expect(mocks.decide).toHaveBeenCalledWith(expect.anything(), false)
    wrapper.unmount()
  })
  it('preserves the authorization request when anonymous', async () => {
    mocks.session.mockResolvedValue(null)
    const wrapper = render()
    await flushPromises()
    expect(mocks.replace).toHaveBeenCalledWith({
      name: 'login',
      query: { redirect: mocks.route.fullPath },
    })
    expect(mocks.preview).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
