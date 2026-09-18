// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { ElCard, ElResult } from 'element-plus'
const { route } = vi.hoisted(() => ({ route: { query: {} as Record<string, unknown> } }))
vi.mock('vue-router', () => ({ useRoute: () => route }))
vi.mock('@/locales', () => ({ i18ns: { t: (key: string) => key } }))
import OAuthResultView from '@/views/auth/OAuthResultView.vue'

describe('OAuth browser result', () => {
  it.each(['success', 'failed', undefined, ['success']])(
    'renders a safe informational result for %s',
    (status) => {
      route.query = {
        status,
        code: 'never-render-code',
        token: 'never-render-token',
        error: '<script>untrusted</script>',
      }
      const wrapper = mount(OAuthResultView, {
        global: { stubs: { 'el-result': false }, components: { ElCard, ElResult } },
      })
      expect(wrapper.text()).toContain(
        status === 'success' ? 'oauthResult.successTitle' : 'oauthResult.failureTitle',
      )
      expect(wrapper.text()).toContain('oauthResult.returnToCli')
      expect(wrapper.text()).not.toContain('never-render')
      expect(wrapper.text()).not.toContain('untrusted')
      wrapper.unmount()
    },
  )
})
