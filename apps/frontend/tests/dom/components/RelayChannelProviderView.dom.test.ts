// @vitest-environment jsdom
import { computed, defineComponent, h, inject, provide, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RelayChannelProviderView from '@/views/relay/RelayChannelProviderView.vue'

const {
  listMySubmittedChannelsMock,
  listMyChangeRequestsMock,
  getModelPricingMock,
  updateSubmittedChannelServiceStatusMock,
  confirmMock,
} = vi.hoisted(() => ({
  listMySubmittedChannelsMock: vi.fn(),
  listMyChangeRequestsMock: vi.fn(),
  getModelPricingMock: vi.fn(),
  updateSubmittedChannelServiceStatusMock: vi.fn(),
  confirmMock: vi.fn(),
}))

vi.mock('element-plus', () => ({
  ElMessage: { success: vi.fn(), error: vi.fn() },
  ElMessageBox: { confirm: confirmMock },
}))

vi.mock('@/composables/usePageDevice', () => ({
  usePageDevice: () => ({ isDesktop: ref(true), isMobile: ref(false) }),
}))

vi.mock('@/stores/permissionStore', () => ({
  usePermissionStore: () => ({
    hasPermission: (permission: string) => permission === 'relay:channel:submit',
  }),
}))

vi.mock('@/service/relayChannelService', () => ({
  relayChannelService: {
    listMySubmittedChannels: listMySubmittedChannelsMock,
    listMyChangeRequests: listMyChangeRequestsMock,
    updateSubmittedChannelServiceStatus: updateSubmittedChannelServiceStatusMock,
    submitChannel: vi.fn(),
    createChangeRequest: vi.fn(),
    deleteSubmittedChannel: vi.fn(),
    listUpstreamModels: vi.fn(),
  },
}))

vi.mock('@/service/modelPricingService', () => ({
  modelPricingService: {
    getModelPricing: getModelPricingMock,
  },
}))

const ElTableStub = defineComponent({
  name: 'ElTable',
  props: { data: { type: Array, default: () => [] } },
  setup(props, { slots }) {
    provide(
      'relay-provider-rows',
      computed(() => props.data),
    )
    return () => h('div', { class: 'el-table-stub' }, slots.default?.())
  },
})

const ElTableColumnStub = defineComponent({
  name: 'ElTableColumn',
  setup(_props, { slots }) {
    const rows = computed(() => []) as ReturnType<typeof computed<any[]>>
    const injectedRows = inject('relay-provider-rows', rows) as ReturnType<typeof computed<any[]>>
    return () =>
      h(
        'div',
        slots.default ? injectedRows.value.flatMap((row) => slots.default?.({ row }) ?? []) : [],
      )
  },
})

const slotStub = (name: string, tag = 'div') =>
  defineComponent({
    name,
    inheritAttrs: true,
    setup(_props, { attrs, slots }) {
      return () => h(tag, attrs, slots.default?.())
    },
  })

const channel = (overrides: Record<string, unknown> = {}) => ({
  id: 'channel-1',
  name: 'Supplier upstream',
  enabled: true,
  providerServiceEnabled: true,
  serviceEnabled: true,
  submissionStatus: 'approved',
  providers: [],
  ...overrides,
})

const mountView = () =>
  mount(RelayChannelProviderView, {
    global: {
      stubs: {
        'el-card': slotStub('ElCard'),
        'el-table': ElTableStub,
        'el-table-column': ElTableColumnStub,
        'el-pagination': slotStub('ElPagination'),
        'el-tag': slotStub('ElTag', 'span'),
        'el-button': slotStub('ElButton', 'button'),
        RelayStandaloneChannelDrawer: defineComponent({
          name: 'RelayStandaloneChannelDrawer',
          props: { modelOptions: { type: Array, default: () => [] } },
          setup(_props, { slots }) {
            return () => h('div', slots.default?.())
          },
        }),
      },
    },
  })

describe('RelayChannelProviderView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    confirmMock.mockResolvedValue(undefined)
    getModelPricingMock.mockResolvedValue([])
    listMyChangeRequestsMock.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 100 })
    updateSubmittedChannelServiceStatusMock.mockResolvedValue(channel())
  })

  it('shows effective online, provider-paused, and administrator-disabled states', async () => {
    listMySubmittedChannelsMock.mockResolvedValue({
      items: [
        channel(),
        channel({ id: 'paused', providerServiceEnabled: false, serviceEnabled: false }),
        channel({
          id: 'disabled',
          enabled: false,
          providerServiceEnabled: false,
          serviceEnabled: false,
        }),
      ],
      total: 3,
      page: 1,
      pageSize: 20,
    })

    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.text()).toContain('服务中')
    expect(wrapper.text()).toContain('供应者已暂停')
    expect(wrapper.text()).toContain('管理员已禁用')
    expect(wrapper.text()).toContain('暂停服务')
    expect(wrapper.text()).toContain('恢复服务')
  })

  it('resumes a paused approved channel through the supplier service endpoint', async () => {
    listMySubmittedChannelsMock.mockResolvedValue({
      items: [channel({ providerServiceEnabled: false, serviceEnabled: false })],
      total: 1,
      page: 1,
      pageSize: 20,
    })

    const wrapper = mountView()
    await flushPromises()
    const resumeButton = wrapper.findAll('button').find((button) => button.text() === '恢复服务')
    expect(resumeButton).toBeDefined()

    await resumeButton!.trigger('click')
    await flushPromises()

    expect(updateSubmittedChannelServiceStatusMock).toHaveBeenCalledWith('channel-1', {
      enabled: true,
    })
  })

  it('loads all configured models for channel submission', async () => {
    getModelPricingMock.mockResolvedValue([
      { model: 'gpt-4o', supportedFormats: 'openai-chat-completions' },
      { model: 'claude-3-7-sonnet', supportedFormats: 'openai-chat-completions' },
    ])

    const wrapper = mountView()
    await flushPromises()

    expect(getModelPricingMock).toHaveBeenCalledOnce()
    const drawer = wrapper.findComponent({ name: 'RelayStandaloneChannelDrawer' })
    expect(drawer.props('modelOptions')).toEqual([
      { value: 'gpt-4o', label: 'gpt-4o' },
      { value: 'claude-3-7-sonnet', label: 'claude-3-7-sonnet' },
    ])
  })
})
