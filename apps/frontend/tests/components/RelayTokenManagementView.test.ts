import { computed, defineComponent, inject, provide, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MANAGED_STATUS } from '@/constant/status'

const {
  getRelayTokensMock,
  getAvailableModelsMock,
  createRelayTokenMock,
  updateTokenMock,
  refreshRelayTokenMock,
  getTokenSwitchLogsMock,
  listChannelsMock,
  messageSuccessMock,
  messageErrorMock,
  confirmMock,
  clipboardWriteTextMock,
  deviceModeMock,
} = vi.hoisted(() => ({
  getRelayTokensMock: vi.fn(),
  getAvailableModelsMock: vi.fn(),
  createRelayTokenMock: vi.fn(),
  updateTokenMock: vi.fn(),
  refreshRelayTokenMock: vi.fn(),
  getTokenSwitchLogsMock: vi.fn(),
  listChannelsMock: vi.fn(),
  messageSuccessMock: vi.fn(),
  messageErrorMock: vi.fn(),
  confirmMock: vi.fn(),
  clipboardWriteTextMock: vi.fn(),
  deviceModeMock: {
    isDesktop: true,
    isMobile: false,
  },
}))

vi.mock('@/service/relayTokenService', () => ({
  relayTokenService: {
    getRelayTokens: getRelayTokensMock,
    getAvailableModels: getAvailableModelsMock,
    createRelayToken: createRelayTokenMock,
    updateToken: updateTokenMock,
    refreshRelayToken: refreshRelayTokenMock,
    toggleTokenStatus: vi.fn(),
    deleteRelayToken: vi.fn(),
    getTokenSwitchLogs: getTokenSwitchLogsMock,
  },
}))

vi.mock('@/service/relayChannelService', () => ({
  relayChannelService: {
    listChannels: listChannelsMock,
  },
}))

vi.mock('@/composables/usePageDevice', () => ({
  usePageDevice: () => ({
    isDesktop: ref(deviceModeMock.isDesktop),
    isMobile: ref(deviceModeMock.isMobile),
  }),
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

vi.mock('@element-plus/icons-vue', () => ({
  ArrowDown: defineComponent({ name: 'ArrowDownIcon', template: '<span />' }),
  ArrowRight: defineComponent({ name: 'ArrowRightIcon', template: '<span />' }),
  ArrowUp: defineComponent({ name: 'ArrowUpIcon', template: '<span />' }),
  DocumentCopy: defineComponent({ name: 'DocumentCopyIcon', template: '<span />' }),
  Clock: defineComponent({ name: 'ClockIcon', template: '<span />' }),
  Delete: defineComponent({ name: 'DeleteIcon', template: '<span />' }),
  QuestionFilled: defineComponent({ name: 'QuestionFilledIcon', template: '<span />' }),
  Refresh: defineComponent({ name: 'RefreshIcon', template: '<span />' }),
  Rank: defineComponent({ name: 'RankIcon', template: '<span />' }),
}))

vi.mock('@/stores/permissionStore', () => ({
  usePermissionStore: () => ({
    hasPermission: vi.fn(() => true),
  }),
}))

vi.mock('@/stores/userInfoStore', () => ({
  useUserInfoStore: () => ({
    userInfo: { id: 'admin-user', username: 'admin', name: 'Admin User' },
  }),
}))

import RelayTokenManagementView from '@/views/relay/RelayTokenManagementView.vue'

const ElCardStub = defineComponent({
  name: 'ElCard',
  template: '<div class="el-card-stub"><slot name="header" /><slot /></div>',
})

const ElTableStub = defineComponent({
  name: 'ElTable',
  props: { data: { type: Array, default: () => [] } },
  setup(props) {
    provide('tableRows', computed(() => props.data as any[]))
  },
  template: '<div class="el-table-stub"><slot /></div>',
})

const ElTableColumnStub = defineComponent({
  name: 'ElTableColumn',
  props: { prop: { type: String, default: '' } },
  setup() {
    const rows = inject<any>('tableRows', ref([]))
    return { rows }
  },
  template:
    '<div class="el-table-column-stub"><template v-for="(row, index) in rows" :key="index"><slot :row="row" /></template></div>',
})

const ElDialogStub = defineComponent({
  name: 'ElDialog',
  props: { modelValue: { type: Boolean, default: false } },
  emits: ['update:modelValue'],
  template: '<div class="el-dialog-stub"><slot /><slot name="footer" /></div>',
})

const ElDrawerStub = defineComponent({
  name: 'ElDrawer',
  props: { modelValue: { type: Boolean, default: false } },
  emits: ['update:modelValue'],
  template: '<div class="el-drawer-stub" v-if="modelValue"><slot /><slot name="footer" /></div>',
})

const ElFormStub = defineComponent({ name: 'ElForm', template: '<form><slot /></form>' })
const ElFormItemStub = defineComponent({ name: 'ElFormItem', template: '<div><slot /></div>' })
const ElTagStub = defineComponent({ name: 'ElTag', template: '<span><slot /></span>' })
const ElTooltipStub = defineComponent({ name: 'ElTooltip', template: '<div><slot /><slot name="content" /></div>' })
const ElDatePickerStub = defineComponent({ name: 'ElDatePicker', template: '<input class="date-picker-stub" />' })
const ElEmptyStub = defineComponent({ name: 'ElEmpty', template: '<div class="empty-stub"></div>' })
const ElIconStub = defineComponent({ name: 'ElIcon', template: '<i><slot /></i>' })
const ElLinkStub = defineComponent({ name: 'ElLink', template: '<a><slot /></a>' })

const ElInputStub = defineComponent({
  name: 'ElInput',
  props: { modelValue: { type: String, default: '' } },
  emits: ['update:modelValue'],
  methods: {
    onInput(event: Event) {
      this.$emit('update:modelValue', (event.target as HTMLInputElement)?.value ?? '')
    },
  },
  template: '<input class="el-input-stub" :value="modelValue" @input="onInput" />',
})

const ElInputTagStub = defineComponent({
  name: 'ElInputTag',
  props: { modelValue: { type: Array, default: () => [] } },
  emits: ['update:modelValue'],
  template: '<div class="el-input-tag-stub"><slot /></div>',
})

const ElInputNumberStub = defineComponent({
  name: 'ElInputNumber',
  props: { modelValue: { type: Number, default: 0 } },
  emits: ['update:modelValue'],
  methods: {
    onInput(event: Event) {
      this.$emit('update:modelValue', Number((event.target as HTMLInputElement)?.value ?? 0))
    },
  },
  template: '<input class="el-input-number-stub" :value="modelValue" @input="onInput" />',
})

const ElSwitchStub = defineComponent({
  name: 'ElSwitch',
  props: { modelValue: { type: Boolean, default: false } },
  emits: ['update:modelValue'],
  template: '<button class="el-switch-stub" @click="$emit(\'update:modelValue\', !modelValue)">{{ modelValue }}</button>',
})

const ElButtonStub = defineComponent({
  name: 'ElButton',
  emits: ['click'],
  template: '<button class="el-button-stub" @click="$emit(\'click\')"><slot /></button>',
})

const ElSelectStub = defineComponent({
  name: 'ElSelect',
  props: {
    modelValue: {
      type: [Array, String],
      default: undefined,
    },
  },
  emits: ['update:modelValue'],
  template: '<div class="el-select-stub"><slot /></div>',
})

const ElOptionStub = defineComponent({
  name: 'ElOption',
  props: {
    label: { type: String, default: '' },
    value: { type: [String, Number], default: '' },
  },
  template: '<div class="el-option-stub">{{ label }}</div>',
})

const PermissionWrapperStub = defineComponent({
  name: 'PermissionWrapper',
  props: { require: { type: [Array, String], default: undefined } },
  template: '<div class="permission-wrapper-stub"><slot /></div>',
})

const mountView = () =>
  mount(RelayTokenManagementView, {
    global: {
      directives: {
        loading: {},
      },
      stubs: {
        'el-card': ElCardStub,
        'el-table': ElTableStub,
        'el-table-column': ElTableColumnStub,
        'el-dialog': ElDialogStub,
        'el-drawer': ElDrawerStub,
        'el-form': ElFormStub,
        'el-form-item': ElFormItemStub,
        'el-tag': ElTagStub,
        'el-tooltip': ElTooltipStub,
        'el-button': ElButtonStub,
        'el-select': ElSelectStub,
        'el-option': ElOptionStub,
        'el-switch': ElSwitchStub,
        'el-input-number': ElInputNumberStub,
        'el-input': ElInputStub,
        'el-input-tag': ElInputTagStub,
        'el-date-picker': ElDatePickerStub,
        'el-empty': ElEmptyStub,
        'el-icon': ElIconStub,
        'el-link': ElLinkStub,
        PermissionWrapper: PermissionWrapperStub,
      },
    },
  })

const channelPrimary = {
  id: 'channel-primary',
  name: 'Primary',
  multiplier: 1,
  allowedModels: JSON.stringify(['gpt-4o', 'provider/model-a']),
} as any

const channelSecondary = {
  id: 'channel-secondary',
  name: 'Secondary',
  multiplier: 1,
  allowedModels: null,
} as any

const channelTertiary = {
  id: 'channel-tertiary',
  name: 'Tertiary',
  multiplier: 1,
  allowedModels: null,
} as any

const relayToken = {
  id: 'token-1',
  name: 'Token 1',
  token: 'rlt_abcdefghijklmnopqrstuvwxyz',
  balance: 0,
  totalTokens: 12,
  requestCount: 1,
  channelId: 'channel-primary',
  channelName: 'Primary',
  expiresAt: null,
  lastUsedAt: null,
  createTime: '2026-04-25T10:00:00.000Z',
  status: MANAGED_STATUS.ENABLED,
  quotaLimit: null,
  quotaWindows: [
    {
      id: 'quota-window-amount',
      quotaLimit: 12.5,
      quotaUnit: 'amount',
      quotaWindowHours: 24,
      usedQuota: 6.25,
      remainingQuota: 6.25,
      quotaUsagePercent: 50,
      isQuotaExceeded: false,
    },
    {
      id: 'quota-window-request',
      quotaLimit: 3,
      quotaUnit: 'request',
      quotaWindowHours: 24,
      usedQuota: 4,
      remainingQuota: 0,
      quotaUsagePercent: 133.3333,
      isQuotaExceeded: true,
    },
  ],
  allowedModels: 'gpt-4o,custom-model',
  channelConfigs: [
    {
      channelId: 'channel-primary',
      channelName: 'Primary',
      priority: 0,
      successCount: 1,
      failureCount: 0,
      successRate: 1,
    },
  ],
  failoverConfig: {
    enabled: true,
    maxRetries: 2,
    retryStatusCodes: ['4xx', '/^5(02|03)$/'],
    failoverThreshold: 0,
    failbackCooldownMinutes: 0,
  },
} as any

const createRelayTokenFixture = (overrides: Record<string, any> = {}) => ({
  ...relayToken,
  ...overrides,
})

describe('RelayTokenManagementView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    deviceModeMock.isDesktop = true
    deviceModeMock.isMobile = false
    getRelayTokensMock.mockResolvedValue({
      items: [relayToken],
      page: 1,
      pageSize: 20,
      total: 1,
    })
    getAvailableModelsMock.mockResolvedValue({
      modelNames: ['gpt-4o', 'claude-3.5-sonnet'],
      modelIdToModelNameMap: {
        'provider/model-a': 'claude-3.5-sonnet',
      },
    })
    getTokenSwitchLogsMock.mockResolvedValue({ logs: [] })
    listChannelsMock.mockResolvedValue([channelPrimary, channelSecondary, channelTertiary])
    createRelayTokenMock.mockResolvedValue({ id: 'created-token' })
    updateTokenMock.mockResolvedValue({ id: relayToken.id })
    refreshRelayTokenMock.mockResolvedValue({ ...relayToken, token: 'rlt_refreshed_token_value' })
    confirmMock.mockResolvedValue(undefined)

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: clipboardWriteTextMock,
      },
    })
  })

  it('loads initial data on mount', async () => {
    mountView()
    await flushPromises()

    expect(getRelayTokensMock).toHaveBeenCalledTimes(1)
    expect(listChannelsMock).toHaveBeenCalledTimes(1)
    expect(getAvailableModelsMock).toHaveBeenCalledTimes(1)
  })

  it('renders quota window consumption details on desktop', async () => {
    const wrapper = mountView()
    await flushPromises()

    const renderedText = wrapper.text()
    expect(renderedText).toContain('请求次数')
    expect(renderedText).toContain('总Token数')
    expect(renderedText).toContain('1')
    expect(renderedText).toContain('12')
    expect(renderedText).toContain('已启用自动切换')
    expect(renderedText).toContain('最大渠道切换次数: 2')
    expect(renderedText).toContain('4 请求次数 / 3 请求次数 / 天')
    expect(renderedText).not.toContain('6.25 曲 / 12.5 曲 / 天')
    expect(renderedText).toContain('更多 1')
  })

  it('renders quota window consumption details on mobile', async () => {
    deviceModeMock.isDesktop = false
    deviceModeMock.isMobile = true

    const wrapper = mountView()
    await flushPromises()

    const renderedText = wrapper.text()
    expect(renderedText).toContain('1 / 12')
    expect(renderedText).toContain('已启用自动切换 · 最大渠道切换次数: 2')
    expect(renderedText).toContain('4 请求次数 / 3 请求次数 / 天')
    expect(renderedText).toContain('更多 1')
  })

  it('does not render quota window usage details when token has no windows configured', async () => {
    getRelayTokensMock.mockResolvedValue({
      items: [createRelayTokenFixture({ quotaWindows: [] })],
      page: 1,
      pageSize: 20,
      total: 1,
    })

    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.text()).not.toContain('窗口额度规则暂未设置')
    expect(wrapper.text()).not.toContain('6.25 曲 / 12.5 曲 / 天')
    expect(wrapper.text()).not.toContain('4 请求次数 / 3 请求次数 / 天')
  })

  it('collapses extra ordered channels into a more indicator', async () => {
    getRelayTokensMock.mockResolvedValue({
      items: [
        createRelayTokenFixture({
          channelConfigs: [
            {
              channelId: 'channel-primary',
              channelName: 'Primary',
              priority: 0,
              successCount: 1,
              failureCount: 0,
              successRate: 1,
            },
            {
              channelId: 'channel-secondary',
              channelName: 'Secondary',
              priority: 1,
              successCount: 1,
              failureCount: 0,
              successRate: 1,
            },
            {
              channelId: 'channel-tertiary',
              channelName: 'Tertiary',
              priority: 2,
              successCount: 1,
              failureCount: 0,
              successRate: 1,
            },
          ],
        }),
      ],
      page: 1,
      pageSize: 20,
      total: 1,
    })

    const wrapper = mountView()
    await flushPromises()

    const renderedText = wrapper.text()
    expect(renderedText).toContain('#1 Primary')
    expect(renderedText).toContain('#2 Secondary')
    expect(renderedText).toContain('更多 1')
  })

  it('renders amount quota windows with remaining usage details', async () => {
    getRelayTokensMock.mockResolvedValue({
      items: [
        createRelayTokenFixture({
          quotaWindows: [
            {
              id: 'quota-window-amount-only',
              quotaLimit: 8.8888,
              quotaUnit: 'amount',
              quotaWindowHours: 12,
              usedQuota: 0,
              remainingQuota: 8.8888,
              quotaUsagePercent: 0,
              isQuotaExceeded: false,
            },
          ],
        }),
      ],
      page: 1,
      pageSize: 20,
      total: 1,
    })

    const wrapper = mountView()
    await flushPromises()

    const renderedText = wrapper.text()
    expect(renderedText).toContain('0 曲 / 8.8888 曲 / 12小时')
  })

  it('opens quota window detail drawer to show all rules', async () => {
    const wrapper = mountView()
    await flushPromises()

    const moreButton = wrapper.find('button.quota-window-inline__more')

    expect(moreButton.exists()).toBe(true)

    await moreButton.trigger('click')
    await flushPromises()

    const renderedText = wrapper.text()
    expect(renderedText).toContain('6.25 曲 / 12.5 曲 / 天')
    expect(renderedText).toContain('4 请求次数 / 3 请求次数 / 天')
  })

  it('submits default wildcard failover rules when creating a token', async () => {
    const wrapper = mountView()
    await flushPromises()
    const vm = wrapper.vm as any

    vm.openCreateDialog()
    vm.editForm.channelConfigs = [{ channelId: 'channel-primary', priority: 0 }]
    vm.editForm.channelId = 'channel-primary'
    await vm.handleSave()
    await flushPromises()

    expect(createRelayTokenMock).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: 'channel-primary',
        channelConfigs: [{ channelId: 'channel-primary', priority: 0 }],
        failoverConfig: expect.objectContaining({
          enabled: false,
          maxRetries: 1,
          retryStatusCodes: ['4xx', '5xx'],
          failoverThreshold: 0,
          failbackCooldownMinutes: 0,
        }),
      }),
    )
  })

  it('normalizes and submits custom wildcard and regex rules on update', async () => {
    const wrapper = mountView()
    await flushPromises()
    const vm = wrapper.vm as any

    vm.openEditDialog(relayToken)
    vm.editForm.failoverConfig.retryStatusCodes = [' 4XX ', '/^5(02|03)$/', '503', '4xx']
    await vm.handleSave()
    await flushPromises()

    expect(updateTokenMock).toHaveBeenCalledWith(
      relayToken.id,
      expect.objectContaining({
        failoverConfig: expect.objectContaining({
          retryStatusCodes: ['4xx', '/^5(02|03)$/', '503'],
        }),
      }),
    )
  })

  it('normalizes quota window rules before submit', async () => {
    const wrapper = mountView()
    await flushPromises()
    const vm = wrapper.vm as any

    vm.openCreateDialog()
    vm.editForm.channelConfigs = [{ channelId: 'channel-primary', priority: 0 }]
    vm.editForm.channelId = 'channel-primary'
     vm.editForm.quotaWindowsEnabled = true
    vm.editForm.quotaWindows = [
      {
        id: 'window-1',
        quotaUnit: 'amount',
        quotaLimit: 12.34567,
        quotaWindowHours: 24,
        months: 0,
        days: 1,
        hours: 0,
        minutes: 0,
      },
      {
        id: 'window-2',
        quotaUnit: 'token',
        quotaLimit: 42.8,
        quotaWindowHours: 5.5,
        months: 0,
        days: 0,
        hours: 5,
        minutes: 30,
      },
    ]

    await vm.handleSave()
    await flushPromises()

    expect(createRelayTokenMock).toHaveBeenCalledWith(
      expect.objectContaining({
        quotaWindows: [
          {
            quotaUnit: 'amount',
            quotaLimit: 12.3457,
            quotaWindowHours: 24,
          },
          {
            quotaUnit: 'token',
            quotaLimit: 42,
            quotaWindowHours: 5.5,
          },
        ],
      }),
    )
  })

       it('omits quotaWindows on update when existing disabled state remains unchanged', async () => {
       const wrapper = mountView()
       await flushPromises()
       const vm = wrapper.vm as any

       vm.openEditDialog(createRelayTokenFixture({ quotaWindows: [] }))
       vm.editForm.channelConfigs = [{ channelId: 'channel-primary', priority:0 }]
       vm.editForm.channelId = 'channel-primary'
       vm.editForm.quotaWindowsEnabled = false
       vm.editForm.quotaWindows = []

       await vm.handleSave()
       await flushPromises()

       expect(updateTokenMock).toHaveBeenCalledWith(
       relayToken.id,
       expect.not.objectContaining({
       quotaWindows: expect.anything(),
       }),
       )
       })

       it('sends quotaWindows empty array on update when user clears existing windows', async () => {
       const wrapper = mountView()
       await flushPromises()
       const vm = wrapper.vm as any

       vm.openEditDialog(relayToken)
       vm.editForm.channelConfigs = [{ channelId: 'channel-primary', priority:0 }]
       vm.editForm.channelId = 'channel-primary'
       vm.editForm.quotaWindowsEnabled = false
       vm.editForm.quotaWindows = []

       await vm.handleSave()
       await flushPromises()

       expect(updateTokenMock).toHaveBeenCalledWith(
       relayToken.id,
       expect.objectContaining({
       quotaWindows: [],
       }),
       )
       })

       it('replaces quotaWindows with non-empty array on update', async () => {
       const wrapper = mountView()
       await flushPromises()
       const vm = wrapper.vm as any

       vm.openEditDialog(relayToken)
       vm.editForm.channelConfigs = [{ channelId: 'channel-primary', priority:0 }]
       vm.editForm.channelId = 'channel-primary'
       vm.editForm.quotaWindowsEnabled = true
       vm.editForm.quotaWindows = [
       {
       id: 'window-replace-1',
       quotaUnit: 'request',
       quotaLimit:9,
       quotaWindowHours:12,
       months:0,
       days:0,
       hours:12,
       minutes:0,
       },
       ]

       await vm.handleSave()
       await flushPromises()

       expect(updateTokenMock).toHaveBeenCalledWith(
       relayToken.id,
       expect.objectContaining({
       quotaWindows: [
       {
       quotaUnit: 'request',
       quotaLimit:9,
       quotaWindowHours:12,
       },
       ],
       }),
       )
       })

  it('rejects duplicate quota window rules before submit', async () => {
    const wrapper = mountView()
    await flushPromises()
    const vm = wrapper.vm as any

    vm.openCreateDialog()
    vm.editForm.channelConfigs = [{ channelId: 'channel-primary', priority: 0 }]
    vm.editForm.channelId = 'channel-primary'
     vm.editForm.quotaWindowsEnabled = true
    vm.editForm.quotaWindows = [
      {
        id: 'window-1',
        quotaUnit: 'request',
        quotaLimit: 10,
        quotaWindowHours: 24,
        months: 0,
        days: 1,
        hours: 0,
        minutes: 0,
      },
      {
        id: 'window-2',
        quotaUnit: 'request',
        quotaLimit: 20,
        quotaWindowHours: 24,
        months: 0,
        days: 1,
        hours: 0,
        minutes: 0,
      },
    ]

    await vm.handleSave()
    await flushPromises()

    expect(createRelayTokenMock).not.toHaveBeenCalled()
    expect(messageErrorMock).toHaveBeenCalledWith(expect.stringContaining('不能重复'))
  })

  it('shows validation error for invalid custom retry rules', async () => {
    const wrapper = mountView()
    await flushPromises()
    const vm = wrapper.vm as any

    vm.openEditDialog(relayToken)
    vm.editForm.failoverConfig.retryStatusCodes = ['bad-rule']
    await vm.handleSave()
    await flushPromises()

    expect(updateTokenMock).not.toHaveBeenCalled()
    expect(messageErrorMock).toHaveBeenCalledWith(expect.stringContaining('bad-rule'))
  })

  it('normalizes ip whitelist entries before submit', async () => {
    const wrapper = mountView()
    await flushPromises()
    const vm = wrapper.vm as any

    vm.openCreateDialog()
    vm.editForm.channelConfigs = [{ channelId: 'channel-primary', priority: 0 }]
    vm.editForm.channelId = 'channel-primary'
    vm.editForm.ipWhitelist = [' 127.0.0.1 ', '203.0.113.10', '127.0.0.1', '', ' 10.0.0.0/24 ']

    await vm.handleSave()
    await flushPromises()

    expect(createRelayTokenMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ipWhitelist: '127.0.0.1\n203.0.113.10\n10.0.0.0/24',
      }),
    )
    expect(vm.editForm.ipWhitelist).toEqual(['127.0.0.1', '203.0.113.10', '10.0.0.0/24'])
  })

  it('loads switch logs for a token on demand', async () => {
    const wrapper = mountView()
    await flushPromises()
    const vm = wrapper.vm as any

    await vm.openSwitchLogsDialog(relayToken)
    await flushPromises()

    expect(getTokenSwitchLogsMock).toHaveBeenCalledWith(relayToken.id, 50, undefined)
  })

  it('refreshes token after confirmation and copies the new token', async () => {
    const wrapper = mountView()
    await flushPromises()
    const vm = wrapper.vm as any

    await vm.handleRefreshToken(relayToken)
    await flushPromises()

    expect(confirmMock).toHaveBeenCalledTimes(1)
    expect(refreshRelayTokenMock).toHaveBeenCalledWith(relayToken.id, undefined)
    expect(clipboardWriteTextMock).toHaveBeenCalledWith('rlt_refreshed_token_value')
    expect(messageSuccessMock).toHaveBeenCalledWith('令牌刷新成功，已复制到剪贴板')
    expect(getRelayTokensMock).toHaveBeenCalledTimes(2)
  })

  it('copies token text to clipboard', async () => {
    const wrapper = mountView()
    await flushPromises()
    const vm = wrapper.vm as any

    vm.copyToken(relayToken.token)
    await flushPromises()

    expect(clipboardWriteTextMock).toHaveBeenCalledWith(relayToken.token)
    expect(messageSuccessMock).toHaveBeenCalledTimes(1)
  })
})