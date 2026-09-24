// @vitest-environment jsdom
import { defineComponent, h, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RelayChannelModelBatchDialog from '@/views/relay/relay-settings/components/RelayChannelModelBatchDialog.vue'
import { relaySettingsManagementContextKey } from '@/views/relay/relay-settings/context'

const { batchListUpstreamModelsMock, applyModelRestrictionsMock, handleAppliedMock } = vi.hoisted(
  () => ({
    batchListUpstreamModelsMock: vi.fn(),
    applyModelRestrictionsMock: vi.fn(),
    handleAppliedMock: vi.fn(),
  }),
)

vi.mock('@/service/relayChannelService', () => ({
  relayChannelService: {
    batchListUpstreamModels: batchListUpstreamModelsMock,
    applyModelRestrictions: applyModelRestrictionsMock,
  },
}))

vi.mock('@/utils/elementPlusRuntime', () => ({
  ElMessage: { success: vi.fn(), warning: vi.fn() },
  ElMessageBox: { alert: vi.fn() },
}))

vi.mock('@/utils/requestErrorNotice', () => ({
  showRequestErrorNotice: vi.fn(),
}))

const slotStub = (name: string, tag = 'div') =>
  defineComponent({
    name,
    inheritAttrs: true,
    setup(_props, { attrs, slots }) {
      return () => h(tag, attrs, slots.default?.())
    },
  })

const dialogStub = defineComponent({
  name: 'ElDialog',
  inheritAttrs: true,
  setup(_props, { slots }) {
    return () => h('div', [slots.default?.(), slots.footer?.()])
  },
})

const tableStub = defineComponent({
  name: 'ElTable',
  setup() {
    return () => h('div')
  },
})

const tableColumnStub = defineComponent({
  name: 'ElTableColumn',
  setup(_props, { slots }) {
    return () => h('div', slots.default?.())
  },
})

const buttonStub = defineComponent({
  name: 'ElButton',
  inheritAttrs: true,
  setup(_props, { attrs, slots }) {
    return () =>
      h(
        'button',
        {
          ...attrs,
          onClick: () => (attrs.onClick as (() => void) | undefined)?.(),
        },
        slots.default?.(),
      )
  },
})

describe('RelayChannelModelBatchDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    batchListUpstreamModelsMock.mockResolvedValue({
      format: 'openai',
      items: [
        {
          channelId: 'channel-1',
          channelName: 'Channel 1',
          status: 'success',
          models: [{ id: 'gpt-5', matched: true, pricingModel: 'gpt-5' }],
        },
        {
          channelId: 'channel-2',
          channelName: 'Channel 2',
          status: 'success',
          models: [{ id: 'gpt-5', matched: true, pricingModel: 'gpt-5' }],
        },
      ],
    })
    applyModelRestrictionsMock.mockResolvedValue({
      updated: [{ id: 'channel-1' }, { id: 'channel-2' }],
      rejected: [],
    })
  })

  it('probes matched models and applies per-channel merged restrictions', async () => {
    const wrapper = mount(RelayChannelModelBatchDialog, {
      global: {
        provide: {
          [relaySettingsManagementContextKey as symbol]: {
            isDesktop: ref(true),
            showChannelModelBatchDialog: ref(true),
            selectedChannelIds: ref(['channel-1', 'channel-2']),
            handleModelRestrictionsApplied: handleAppliedMock,
          } as any,
        },
        stubs: {
          'el-dialog': dialogStub,
          'el-alert': slotStub('ElAlert'),
          'el-tabs': slotStub('ElTabs'),
          'el-tab-pane': slotStub('ElTabPane'),
          'el-button': buttonStub,
          'el-table': tableStub,
          'el-table-column': tableColumnStub,
          'el-tag': slotStub('ElTag', 'span'),
          'el-checkbox-group': slotStub('ElCheckboxGroup'),
          'el-checkbox': slotStub('ElCheckbox'),
          'el-input': slotStub('ElInput'),
          'el-empty': slotStub('ElEmpty'),
        },
      },
    })

    const buttons = wrapper.findAll('button')
    await buttons[0].trigger('click')
    await flushPromises()

    expect(batchListUpstreamModelsMock).toHaveBeenCalledWith({
      ids: ['channel-1', 'channel-2'],
      format: 'openai',
    })

    const applyButton = wrapper.findAll('button').at(-1)!
    expect(applyButton.text()).toContain('合并并应用模型限制')
    await applyButton.trigger('click')
    await flushPromises()

    expect(applyModelRestrictionsMock).toHaveBeenCalledWith({
      targets: [
        { channelId: 'channel-1', addModels: ['gpt-5'] },
        { channelId: 'channel-2', addModels: ['gpt-5'] },
      ],
    })
    expect(handleAppliedMock).toHaveBeenCalledWith(['channel-1', 'channel-2'])
  })
})
