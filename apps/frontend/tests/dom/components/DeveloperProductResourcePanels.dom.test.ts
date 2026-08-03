// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Permission } from '@/constant/permission'
import PushChannelsPanel from '@/views/products/push/PushChannelsPanel.vue'
import StatusMonitorPanel from '@/views/products/status/StatusMonitorPanel.vue'

const {
  listPushChannelResourcesMock,
  listPushDeliveryResourcesMock,
  listMonitorResourcesMock,
  getStatusPageResourceMock,
  messageErrorMock,
} = vi.hoisted(() => ({
  listPushChannelResourcesMock: vi.fn(),
  listPushDeliveryResourcesMock: vi.fn(),
  listMonitorResourcesMock: vi.fn(),
  getStatusPageResourceMock: vi.fn(),
  messageErrorMock: vi.fn(),
}))

vi.mock('@/service/developerProductService', () => ({
  developerProductService: {
    listPushChannelResources: listPushChannelResourcesMock,
    listPushDeliveryResources: listPushDeliveryResourcesMock,
    listMonitorResources: listMonitorResourcesMock,
    getStatusPageResource: getStatusPageResourceMock,
  },
}))

vi.mock('element-plus', () => ({
  ElMessage: { error: messageErrorMock, success: vi.fn() },
  ElMessageBox: { confirm: vi.fn() },
}))

vi.mock('@/locales', () => ({ i18ns: { t: (key: string) => key } }))
vi.mock('@/utils/error-utils', () => ({ getErrorMessage: () => 'request failed' }))

const mountOptions = {
  global: {
    directives: { loading: {} },
    stubs: {
      'el-alert': { template: '<div><slot />{{ title }}</div>', props: ['title'] },
      'el-button': { template: '<button><slot /></button>' },
      'el-table': { template: '<div><slot /></div>' },
      'el-table-column': { template: '<div />' },
      'el-empty': { template: '<div />' },
      'el-divider': { template: '<hr />' },
      'el-dialog': { template: '<div><slot /><slot name="footer" /></div>' },
      'el-form': { template: '<form><slot /></form>' },
      'el-form-item': { template: '<div><slot /></div>' },
      'el-input': { template: '<input />' },
      'el-input-number': { template: '<input />' },
      'el-select': { template: '<select><slot /></select>' },
      'el-option': { template: '<option />' },
      'el-tag': { template: '<span><slot /></span>' },
    },
  },
}

const instance = { id: 'instance-1', name: 'Primary', slug: 'primary', enabled: true }

describe('developer product resource panels', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listPushChannelResourcesMock.mockResolvedValue([])
    listPushDeliveryResourcesMock.mockResolvedValue([])
    listMonitorResourcesMock.mockResolvedValue([])
    getStatusPageResourceMock.mockResolvedValue({ statusPagePublished: true })
  })

  it('loads delivery logs without requesting channels when only delivery-read is granted', async () => {
    mount(PushChannelsPanel, {
      ...mountOptions,
      props: {
        instance,
        hasPermission: (permission: string) => permission === Permission.PRODUCT_PUSH_DELIVERY_READ,
      },
    })
    await flushPromises()

    expect(listPushDeliveryResourcesMock).toHaveBeenCalledWith(instance.id)
    expect(listPushChannelResourcesMock).not.toHaveBeenCalled()
  })

  it('loads status page publication without requesting monitors when only publish is granted', async () => {
    mount(StatusMonitorPanel, {
      ...mountOptions,
      props: {
        instance,
        hasPermission: (permission: string) => permission === Permission.PRODUCT_STATUS_PUBLISH,
      },
    })
    await flushPromises()

    expect(getStatusPageResourceMock).toHaveBeenCalledWith(instance.id)
    expect(listMonitorResourcesMock).not.toHaveBeenCalled()
  })

  it('shows an inline error when a permitted resource request fails', async () => {
    listPushChannelResourcesMock.mockRejectedValue(new Error('network'))
    const wrapper = mount(PushChannelsPanel, {
      ...mountOptions,
      props: {
        instance,
        hasPermission: (permission: string) =>
          permission === Permission.PRODUCT_PUSH_CHANNEL_MANAGE,
      },
    })
    await flushPromises()

    expect(messageErrorMock).toHaveBeenCalledWith('request failed')
    expect(wrapper.text()).toContain('request failed')
  })
})
