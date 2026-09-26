// @vitest-environment jsdom
import { computed, defineComponent, inject, provide, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { listMock, detailMock, messageErrorMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  detailMock: vi.fn(),
  messageErrorMock: vi.fn(),
}))

vi.mock('@/service/aiRequestLogService', () => ({
  aiRequestLogService: {
    list: listMock,
    detail: detailMock,
  },
}))

vi.mock('@/utils/elementPlusRuntime', () => ({
  ElMessage: {
    error: messageErrorMock,
    success: vi.fn(),
  },
}))

vi.mock('@element-plus/icons-vue', () => ({
  CopyDocument: defineComponent({ name: 'CopyDocumentIcon', template: '<span />' }),
  Refresh: defineComponent({ name: 'RefreshIcon', template: '<span />' }),
  Search: defineComponent({ name: 'SearchIcon', template: '<span />' }),
}))

import AIRequestLogsView from '@/views/relay/AIRequestLogsView.vue'

const passthrough = (name: string) =>
  defineComponent({
    name,
    template: `<div class="${name}"><slot /></div>`,
  })

const ElButtonStub = defineComponent({
  name: 'ElButtonStub',
  emits: ['click'],
  template: '<button class="el-button" @click="$emit(\'click\')"><slot /></button>',
})

const ElInputStub = defineComponent({
  name: 'ElInputStub',
  props: { modelValue: { type: [String, Number], default: '' } },
  emits: ['update:modelValue'],
  template: '<input class="el-input" :value="modelValue" />',
})

const ElDatePickerStub = defineComponent({
  name: 'ElDatePickerStub',
  props: { modelValue: { type: Array, default: null } },
  template: '<div class="el-date-picker" />',
})

const ElSelectStub = passthrough('ElSelectStub')
const ElOptionStub = passthrough('ElOptionStub')
const ElPaginationStub = passthrough('ElPaginationStub')
const ElAlertStub = passthrough('ElAlertStub')
const ElDescriptionsStub = passthrough('ElDescriptionsStub')
const ElDescriptionsItemStub = passthrough('ElDescriptionsItemStub')
const ElTabsStub = passthrough('ElTabsStub')
const ElTabPaneStub = passthrough('ElTabPaneStub')
const ElTagStub = passthrough('ElTagStub')

const ElDrawerStub = defineComponent({
  name: 'ElDrawerStub',
  props: { modelValue: { type: Boolean, default: false } },
  template: '<aside v-if="modelValue" class="el-drawer"><slot /></aside>',
})

const ElTableStub = defineComponent({
  name: 'ElTableStub',
  props: { data: { type: Array, default: () => [] } },
  setup(props) {
    provide(
      'tableRows',
      computed(() => props.data as any[]),
    )
  },
  template: '<div class="el-table"><slot /></div>',
})

const ElTableColumnStub = defineComponent({
  name: 'ElTableColumnStub',
  setup() {
    const rows = inject<any>('tableRows', ref([]))
    return { rows }
  },
  template:
    '<div class="el-table-column"><template v-for="(row, index) in rows" :key="index"><slot :row="row" /></template></div>',
})

const row = {
  id: 'log-1',
  createTime: '2026-09-20T00:00:00.000Z',
  requestId: 'relay-request-1',
  userId: 'user-1',
  username: 'alice',
  relayTokenId: 'token-1',
  relayTokenName: 'main',
  model: 'model-1',
  requestFormat: 'openai-chat-completions',
  path: '/relay/proxy/v1/chat/completions',
  method: 'POST',
  statusCode: 200,
  ipAddress: '127.0.0.1',
  userAgent: 'vitest',
  durationMs: 120,
  requestSizeBytes: 128,
  responseSizeBytes: 256,
  requestTruncated: false,
  responseTruncated: false,
}

const mountView = () =>
  mount(AIRequestLogsView, {
    global: {
      directives: { loading: {} },
      stubs: {
        'el-button': ElButtonStub,
        'el-input': ElInputStub,
        'el-date-picker': ElDatePickerStub,
        'el-select': ElSelectStub,
        'el-option': ElOptionStub,
        'el-pagination': ElPaginationStub,
        'el-alert': ElAlertStub,
        'el-drawer': ElDrawerStub,
        'el-descriptions': ElDescriptionsStub,
        'el-descriptions-item': ElDescriptionsItemStub,
        'el-tabs': ElTabsStub,
        'el-tab-pane': ElTabPaneStub,
        'el-tag': ElTagStub,
        'el-table': ElTableStub,
        'el-table-column': ElTableColumnStub,
      },
    },
  })

describe('AIRequestLogsView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listMock.mockResolvedValue({ items: [row], total: 1, page: 1, pageSize: 20 })
    detailMock.mockResolvedValue({
      ...row,
      requestBody: { messages: [{ role: 'user', content: 'violating content' }] },
      responseBody: { choices: [{ message: { content: 'answer' } }] },
    })
  })

  it('loads metadata and lazily renders the full request and response', async () => {
    const wrapper = mountView()
    await flushPromises()

    expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 20 }))
    const vm = wrapper.vm as any
    expect(vm.records[0].username).toBe('alice')
    expect(vm.records[0].model).toBe('model-1')
    await vm.openDetail(row)
    await flushPromises()

    expect(detailMock).toHaveBeenCalledWith('log-1')
    expect(wrapper.text()).toContain('violating content')
    expect(wrapper.text()).toContain('answer')
  })

  it('shows a truncation warning in the detail view', async () => {
    detailMock.mockResolvedValue({
      ...row,
      requestTruncated: true,
      responseTruncated: false,
      requestBody: { _truncated: true, _preview: 'preview' },
      responseBody: 'ok',
    })
    const wrapper = mountView()
    await flushPromises()

    await (wrapper.vm as any).openDetail(row)
    await flushPromises()

    expect(wrapper.text()).toContain('请求或响应超过保存上限')
  })
})
