// @vitest-environment jsdom
import { computed, defineComponent, inject, provide, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  listAPIKeysMock,
  listChannelOptionsMock,
  messageErrorMock,
  messageSuccessMock,
  confirmMock,
  clipboardWriteMock,
  deviceModeMock,
} = vi.hoisted(() => ({
  listAPIKeysMock: vi.fn(),
  listChannelOptionsMock: vi.fn(),
  messageErrorMock: vi.fn(),
  messageSuccessMock: vi.fn(),
  confirmMock: vi.fn(),
  clipboardWriteMock: vi.fn(),
  deviceModeMock: {
    isDesktop: true,
    isMobile: false,
  },
}))

vi.mock('@/composables/usePageDevice', () => ({
  usePageDevice: () => ({
    isDesktop: ref(deviceModeMock.isDesktop),
    isMobile: ref(deviceModeMock.isMobile),
  }),
}))

vi.mock('@/service/ojAPIKeyService', () => ({
  OJAPIKeyService: {
    getInstance: () => ({
      listAPIKeys: listAPIKeysMock,
      createAPIKey: vi.fn(),
      updateAPIKey: vi.fn(),
      deleteAPIKey: vi.fn(),
    }),
  },
}))

vi.mock('@/service/relayChannelService', () => ({
  relayChannelService: {
    listChannelOptions: listChannelOptionsMock,
  },
}))

vi.mock('element-plus', () => ({
  ElMessage: {
    success: messageSuccessMock,
    error: messageErrorMock,
  },
  ElMessageBox: {
    confirm: confirmMock,
  },
}))

import { i18ns } from '@/locales'
import APIKeyManagementView from '@/views/oj-submitter/APIKeyManagementView.vue'

const ElTableStub = defineComponent({
  name: 'ElTable',
  props: { data: { type: Array, default: () => [] } },
  setup(props) {
    provide(
      'tableRows',
      computed(() => props.data as any[]),
    )
  },
  template: '<div class="el-table-stub"><slot /></div>',
})

const ElTableColumnStub = defineComponent({
  name: 'ElTableColumn',
  props: {
    label: { type: String, default: '' },
    prop: { type: String, default: '' },
  },
  setup() {
    const rows = inject<any>('tableRows', ref([]))
    return { rows }
  },
  template:
    '<div class="el-table-column-stub"><template v-for="(row, index) in rows" :key="index"><slot :row="row" /></template></div>',
})

const ElButtonStub = defineComponent({
  name: 'ElButton',
  emits: ['click'],
  template: '<button type="button" @click="$emit(\'click\')"><slot /></button>',
})

const API_KEY = `ojqa_${'0123456789abcdef'.repeat(4)}`
const MASKED_API_KEY = 'ojqa_012...89abcdef'

const createAPIKeyRecord = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 'apikey-1',
    name: 'default',
    key: API_KEY,
    channelId: 'channel-1',
    channelName: 'Primary',
    requestCount: 3,
    totalTokens: 128,
    lastUsedAt: '2026-01-02T00:00:00.000Z',
    expiresAt: null,
    createTime: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }) as any

const mountView = async () => {
  const wrapper = mount(APIKeyManagementView, {
    global: {
      stubs: {
        'el-table': ElTableStub,
        'el-table-column': ElTableColumnStub,
        'el-button': ElButtonStub,
        'el-dialog': true,
      },
    },
  })
  await flushPromises()
  return wrapper
}

const findCopyButton = (wrapper: ReturnType<typeof mount>) =>
  wrapper
    .findAll('button')
    .find((button) => button.text().trim() === i18ns.t('ojSubmitter.copyKey'))

beforeEach(() => {
  listAPIKeysMock.mockReset()
  listChannelOptionsMock.mockReset()
  messageErrorMock.mockReset()
  messageSuccessMock.mockReset()
  confirmMock.mockReset()
  clipboardWriteMock.mockReset()
  deviceModeMock.isDesktop = true
  deviceModeMock.isMobile = false

  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: clipboardWriteMock },
  })

  listAPIKeysMock.mockResolvedValue([createAPIKeyRecord()])
  listChannelOptionsMock.mockResolvedValue([{ id: 'channel-1', name: 'Primary' }])
})

describe('APIKeyManagementView key masking', () => {
  it('masks the key in the desktop table', async () => {
    const wrapper = await mountView()

    expect(wrapper.text()).toContain(MASKED_API_KEY)
    expect(wrapper.text()).not.toContain(API_KEY)
  })

  it('masks the key in the mobile list instead of rendering the full value', async () => {
    deviceModeMock.isDesktop = false
    deviceModeMock.isMobile = true

    const wrapper = await mountView()

    expect(wrapper.text()).toContain(MASKED_API_KEY)
    expect(wrapper.text()).not.toContain(API_KEY)
  })

  it('still copies the full key when the copy action is used', async () => {
    const wrapper = await mountView()

    const copyButton = findCopyButton(wrapper)
    expect(copyButton).toBeTruthy()

    await copyButton!.trigger('click')
    await flushPromises()

    expect(clipboardWriteMock).toHaveBeenCalledWith(API_KEY)
    expect(messageSuccessMock).toHaveBeenCalled()
  })
})
