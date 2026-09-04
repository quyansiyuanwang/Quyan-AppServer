// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Permission } from '@/constant/permission'
import JsonEndpointPanel from '@/views/products/json-endpoints/JsonEndpointPanel.vue'

const { getJsonEndpointResourceMock, updateJsonEndpointResourceMock, messageSuccessMock } =
  vi.hoisted(() => ({
    getJsonEndpointResourceMock: vi.fn(),
    updateJsonEndpointResourceMock: vi.fn(),
    messageSuccessMock: vi.fn(),
  }))

vi.mock('@/service/developerProductService', () => ({
  developerProductService: {
    getJsonEndpointResource: getJsonEndpointResourceMock,
    updateJsonEndpointResource: updateJsonEndpointResourceMock,
  },
}))
vi.mock('element-plus', () => ({ ElMessage: { success: messageSuccessMock, error: vi.fn() } }))
vi.mock('@/locales', () => ({ i18ns: { t: (key: string) => key } }))

const endpoint = {
  id: 'endpoint-1',
  instanceId: 'instance-1',
  name: 'Primary endpoint',
  slug: 'primary-endpoint',
  jsonContent: { enabled: true },
  publicUrl: '/v1/json/primary-endpoint',
  isPublic: true,
  lastUpdated: '2026-09-04T00:00:00.000Z',
}

const mountPanel = (hasWritePermission = true) =>
  mount(JsonEndpointPanel, {
    props: {
      instance: { id: 'instance-1', name: 'Primary endpoint', slug: 'primary-endpoint' },
      hasPermission: (permission: string) =>
        hasWritePermission && permission === Permission.PRODUCT_JSON_ENDPOINT_WRITE,
    },
    global: {
      directives: { loading: {} },
      stubs: {
        JsonEditor: { template: '<textarea />', props: ['modelValue'] },
        'el-alert': { template: '<div>{{ title }}</div>', props: ['title'] },
        'el-empty': { template: '<div />' },
        'el-tag': { template: '<span><slot /></span>' },
        'el-button': { template: '<button @click="$emit(\'click\')"><slot /></button>' },
      },
    },
  })

describe('JSON endpoint panel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getJsonEndpointResourceMock.mockResolvedValue(endpoint)
    updateJsonEndpointResourceMock.mockResolvedValue(endpoint)
  })

  it('loads the endpoint for the selected instance and exposes the save action to writers', async () => {
    const wrapper = mountPanel()
    await flushPromises()

    expect(getJsonEndpointResourceMock).toHaveBeenCalledWith('instance-1')
    expect(wrapper.find('.json-product-panel__footer button').exists()).toBe(true)
  })

  it('does not render the save action for read-only access', async () => {
    const wrapper = mountPanel(false)
    await flushPromises()

    expect(wrapper.find('.json-product-panel__footer').exists()).toBe(false)
  })
})
