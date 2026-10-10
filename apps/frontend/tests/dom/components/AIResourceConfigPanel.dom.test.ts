// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(async (_value: Record<string, string>) => true),
  error: vi.fn(),
  success: vi.fn(),
}))
vi.mock('@/service/configService', () => ({
  configService: { getAIResourceConfiguration: mocks.get, setConfigs: mocks.set },
}))
vi.mock('@/locales', () => ({ i18ns: { locale: 'en', t: (key: string) => key } }))
vi.mock('@/utils/requestErrorNotice', () => ({ showRequestErrorNotice: mocks.error }))
vi.mock('@/utils/elementPlusRuntime', () => ({ ElMessage: { success: mocks.success } }))
import Panel from '@/views/system/server-config/components/AIResourceConfigPanel.vue'
function fixture() {
  return {
    configKey: 'ai.resources',
    effective: { version: 1, aiResources: { maxActiveRequests: 7 } },
    defaults: { version: 1, aiResources: { maxActiveRequests: 3 } },
    fields: [
      {
        path: 'aiResources.maxActiveRequests',
        group: 'admission',
        label: '并发',
        labelEn: 'Active requests',
        unit: '',
        scale: 1,
        min: 1,
        max: 2147483647,
      },
    ],
    legacyEnvironmentPresent: true,
    source: 'database',
    revision: 'v1',
  }
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.get.mockResolvedValue(fixture())
})
describe('AI resource configuration panel', () => {
  it('loads server-provided defaults and safely clones reactive payloads', async () => {
    const wrapper = mount(Panel)
    await flushPromises()
    expect((wrapper.vm as any).draft.aiResources.maxActiveRequests).toBe(7)
    expect(mocks.error).not.toHaveBeenCalled()
    ;(wrapper.vm as any).reset()
    expect((wrapper.vm as any).draft.aiResources.maxActiveRequests).toBe(3)
    expect((wrapper.vm as any).configuration.effective.aiResources.maxActiveRequests).toBe(7)
    wrapper.unmount()
  })
  it('saves the complete versioned document through the existing protected API', async () => {
    const wrapper = mount(Panel)
    await flushPromises()
    ;(wrapper.vm as any).draft.aiResources.maxActiveRequests = 11
    await (wrapper.vm as any).save()
    expect(
      JSON.parse(mocks.set.mock.calls[0]![0]['ai.resources']).aiResources.maxActiveRequests,
    ).toBe(11)
    expect(mocks.get).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })
  it('shows save failures without discarding the edited values', async () => {
    const wrapper = mount(Panel)
    await flushPromises()
    mocks.set.mockRejectedValueOnce(new Error('offline'))
    await (wrapper.vm as any).save()
    expect(mocks.error).toHaveBeenCalled()
    expect((wrapper.vm as any).draft.aiResources.maxActiveRequests).toBe(7)
    wrapper.unmount()
  })
})
