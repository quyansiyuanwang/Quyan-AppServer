// @vitest-environment jsdom
import { computed, defineComponent, h, inject, provide, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import RelayChannelManagementPanel from '@/views/relay/relay-settings/components/RelayChannelManagementPanel.vue'
import { relaySettingsManagementContextKey } from '@/views/relay/relay-settings/context'

const ElTableStub = defineComponent({
  name: 'ElTable',
  props: { data: { type: Array, default: () => [] } },
  setup(props, { slots }) {
    provide(
      'relay-channel-management-rows',
      computed(() => props.data),
    )
    return () => h('div', { class: 'el-table-stub' }, slots.default?.())
  },
})

const ElTableColumnStub = defineComponent({
  name: 'ElTableColumn',
  setup(_props, { slots }) {
    const rows = inject(
      'relay-channel-management-rows',
      computed(() => []),
    ) as ReturnType<typeof computed<any[]>>
    return () =>
      h('div', slots.default ? rows.value.flatMap((row) => slots.default?.({ row }) ?? []) : [])
  },
})

const slotStub = (name: string, tag = 'div') =>
  defineComponent({
    name,
    setup(_props, { slots }) {
      return () => h(tag, slots.default?.())
    },
  })

const createState = () => ({
  Permission: {
    RELAY_CHANNEL_CREATE: 'relay:channel:create',
    RELAY_CHANNEL_UPDATE: 'relay:channel:update',
    RELAY_CHANNEL_EXPORT: 'relay:channel:export',
  },
  isDesktop: ref(true),
  channelLoading: ref(false),
  channelExporting: ref(false),
  togglingChannelId: ref<string | null>(null),
  poolMemberTooltipDetails: ref({}),
  poolMemberTooltipLoadingIds: ref<string[]>([]),
  channelRows: ref([
    {
      id: 'physical-member-1',
      name: 'Claude-GWL-1',
      enabled: true,
      providerServiceEnabled: false,
      serviceEnabled: false,
      channelType: 'pooled-member',
      routingStrategy: 'priority',
      visibilityMode: 'hidden',
      poolMemberCount: 0,
      pooledParentId: 'logical-pool-1',
      pooledParentName: 'Claude-GWL',
      multiplier: 1,
      updateTime: '2026-08-05T00:00:00.000Z',
    },
  ]),
  channelFilters: ref({ keyword: '', channelType: undefined, enabled: undefined }),
  channelPagination: ref({ page: 1, pageSize: 25, total: 1 }),
  selectedChannelCount: ref(0),
  hasChannelSelection: ref(false),
  isCurrentPageFullySelected: ref(false),
  isChannelSelected: () => false,
  toggleChannelSelection: () => undefined,
  toggleCurrentPageSelection: () => undefined,
  clearChannelSelection: () => undefined,
  setChannelKeyword: () => undefined,
  updateChannelFilters: () => undefined,
  updateChannelPagination: () => undefined,
  loadPoolMemberTooltip: () => undefined,
  formatChannelTypeLabel: (type: string) => type,
  formatVisibilityModeLabel: (mode: string) => mode,
  openCreateChannelDialog: () => undefined,
  openChannelImportDialog: () => undefined,
  exportChannelsAsJson: () => undefined,
  copyChannelsAsJson: () => undefined,
  copyAllChannelsAsJson: () => undefined,
  openChannelDetailDialog: () => undefined,
  openEditChannelDialog: () => undefined,
  handleDuplicateChannel: () => Promise.resolve(),
  handleToggleChannelStatus: () => Promise.resolve(),
  handleDeleteChannel: () => Promise.resolve(),
  handleBatchDuplicateChannels: () => Promise.resolve(),
  handleBatchSetChannelStatus: () => Promise.resolve(),
  openChannelBatchEditDialog: () => undefined,
  openChannelModelPricingMigrationDialog: () => undefined,
  handleBatchDeleteChannels: () => Promise.resolve(),
})

describe('RelayChannelManagementPanel', () => {
  it('shows a physical pooled member parent instead of a zero-member count', () => {
    const wrapper = mount(RelayChannelManagementPanel, {
      global: {
        provide: { [relaySettingsManagementContextKey as symbol]: createState() as any },
        stubs: {
          PermissionWrapper: slotStub('PermissionWrapper'),
          'el-table': ElTableStub,
          'el-table-column': ElTableColumnStub,
          'el-tooltip': slotStub('ElTooltip'),
          'el-tag': slotStub('ElTag', 'span'),
          'el-button': slotStub('ElButton', 'button'),
          'el-dropdown': slotStub('ElDropdown'),
          'el-dropdown-menu': slotStub('ElDropdownMenu'),
          'el-dropdown-item': slotStub('ElDropdownItem'),
          'el-pagination': slotStub('ElPagination'),
          'el-checkbox': slotStub('ElCheckbox'),
          'el-icon': slotStub('ElIcon'),
          'el-input': slotStub('ElInput'),
          'el-select': slotStub('ElSelect'),
          'el-option': slotStub('ElOption'),
          'el-empty': slotStub('ElEmpty'),
        },
      },
    })

    const poolMemberCell = wrapper.find('.relay-channel-management__pool-members-trigger')
    expect(poolMemberCell.text()).toBe('Claude-GWL')
    expect(poolMemberCell.text()).not.toContain('0')
    expect(wrapper.text()).toContain('供应者已暂停')
  })
})
