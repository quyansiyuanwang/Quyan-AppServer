// @vitest-environment jsdom
import { computed, defineComponent, inject, provide, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  listMock,
  detailMock,
  messageErrorMock,
  metadataMock,
  contentMock,
  searchMock,
  attemptsMock,
  canReadAttemptsMock,
} = vi.hoisted(() => ({
  listMock: vi.fn(),
  detailMock: vi.fn(),
  metadataMock: vi.fn(),
  contentMock: vi.fn(),
  searchMock: vi.fn(),
  attemptsMock: vi.fn(),
  canReadAttemptsMock: vi.fn(),
  messageErrorMock: vi.fn(),
}))

vi.mock('@/service/aiRequestLogService', () => ({
  aiRequestLogService: {
    list: listMock,
    detail: detailMock,
    metadata: metadataMock,
    content: contentMock,
    search: searchMock,
    attempts: attemptsMock,
  },
}))

vi.mock('@/stores/permissionStore', () => ({
  usePermissionStore: () => ({ hasPermission: canReadAttemptsMock }),
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
import AIRequestLogDetail from '@/views/relay/ai-request-logs/AIRequestLogDetail.vue'
import AIRequestLogReader from '@/views/relay/ai-request-logs/AIRequestLogReader.vue'

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
const ElTabPaneStub = defineComponent({
  props: ['label', 'name'],
  template: '<div>{{ label }}<slot /></div>',
})
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
        'el-switch': defineComponent({ props: ['modelValue'], template: '<div><slot /></div>' }),
        'el-radio-group': passthrough('RadioGroup'),
        'el-radio-button': passthrough('RadioButton'),
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

const pageResult = (items: any[] = [], extra = {}) => ({
  items,
  hasMore: false,
  nextCursor: null,
  totalItems: items.length,
  storedBytes: 200,
  truncated: false,
  omissionReason: null,
  ...extra,
})
const messageItem = {
  locator: 'WzBd',
  path: '/messages/0',
  section: 'messages',
  label: 'user',
  text: 'human readable request',
  offset: 0,
  totalBytes: 200,
  nextCursor: null,
}
describe('AIRequestLogsView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    canReadAttemptsMock.mockReturnValue(false)
    listMock.mockResolvedValue({ items: [row], total: 1, page: 1, pageSize: 20 })
    metadataMock.mockResolvedValue({ ...row, availableSides: ['request', 'response'] })
    contentMock.mockResolvedValue(pageResult([messageItem]))
    searchMock.mockResolvedValue({
      items: [],
      total: 0,
      nextCursor: null,
      hasMore: false,
      truncated: false,
      omissionReason: null,
    })
    attemptsMock.mockResolvedValue({
      items: [],
      total: 0,
      nextCursor: null,
      hasMore: false,
      truncated: false,
    })
  })
  it('loads only metadata and the first parsed request segment, never the legacy full detail', async () => {
    const wrapper = mountView()
    await flushPromises()
    expect(contentMock).not.toHaveBeenCalled()
    expect(listMock).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 1,
        pageSize: 20,
        startDate: expect.stringMatching(/Z$/),
        endDate: expect.stringMatching(/Z$/),
      }),
      expect.any(AbortSignal),
    )
    await (wrapper.vm as any).openDetail(row)
    await flushPromises()
    expect(metadataMock).toHaveBeenCalledWith('log-1', expect.any(AbortSignal))
    expect(contentMock).toHaveBeenCalledWith(
      'log-1',
      expect.objectContaining({ side: 'request', view: 'parsed' }),
      expect.any(AbortSignal),
    )
    expect(contentMock).toHaveBeenCalledTimes(1)
    expect(detailMock).not.toHaveBeenCalled()
    expect(attemptsMock).not.toHaveBeenCalled()
    expect(wrapper.text().indexOf('解析与格式化')).toBeLessThan(wrapper.text().indexOf('原始内容'))
    wrapper.unmount()
  })
  it('shows unrecorded identity and an unnamed token ID instead of blank cells', async () => {
    listMock.mockResolvedValue({
      items: [{ ...row, username: null, userId: null, relayTokenName: null }],
      total: 1,
    })
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.text()).toContain('未记录')
    expect(wrapper.text()).toContain('未命名令牌')
    expect(wrapper.text()).toContain('token-1')
    wrapper.unmount()
  })
  it('loads the response only after selecting it and resets the full-load switch', async () => {
    const wrapper = mountView()
    await flushPromises()
    ;(wrapper.vm as any).openDetail(row)
    await flushPromises()
    const detail = wrapper.findComponent(AIRequestLogDetail)
    ;(detail.vm as any).side = 'response'
    await flushPromises()
    expect(contentMock.mock.calls.at(-1)?.[1].side).toBe('response')
    expect((wrapper.findComponent(AIRequestLogReader).vm as any).loadAll).toBe(false)
    wrapper.unmount()
  })
  it('shows truncation, omission and retry independently', async () => {
    contentMock.mockResolvedValue(
      pageResult([], { truncated: true, omissionReason: 'invalid-body' }),
    )
    const wrapper = mountView()
    await flushPromises()
    ;(wrapper.vm as any).openDetail(row)
    await flushPromises()
    expect(wrapper.text()).toContain('请求或响应超过保存上限')
    expect(wrapper.text()).toContain('正文无法安全解析')
    wrapper.unmount()
  })
  it('searches unloaded text, renders match text safely, and locates a bounded fragment', async () => {
    searchMock.mockResolvedValue({
      items: [
        {
          side: 'request',
          locator: 'WzBd',
          path: '/tools/97/description',
          section: 'tools',
          excerpt: '<script>needle</script>',
          matchStart: 8,
          matchEnd: 14,
          offset: 40000,
        },
      ],
      total: 1,
      nextCursor: null,
      hasMore: false,
      truncated: false,
      omissionReason: null,
    })
    const wrapper = mountView()
    await flushPromises()
    ;(wrapper.vm as any).openDetail(row)
    await flushPromises()
    const detail = wrapper.findComponent(AIRequestLogDetail)
    ;(detail.vm as any).keyword = 'needle'
    await flushPromises()
    await (detail.vm as any).searchContent()
    await flushPromises()
    expect(wrapper.find('mark').text()).toBe('needle')
    expect(wrapper.find('script').exists()).toBe(false)
    await wrapper.find('.search-hit').trigger('click')
    await flushPromises()
    expect(contentMock.mock.calls.at(-1)?.[1]).toMatchObject({
      locator: 'WzBd',
      offset: 40000,
      view: 'raw',
    })
    wrapper.unmount()
  })
  it('does not allow attempt data to load without the diagnostic permission', async () => {
    const wrapper = mountView()
    await flushPromises()
    ;(wrapper.vm as any).openDetail(row)
    await flushPromises()
    await (wrapper.findComponent(AIRequestLogDetail).vm as any).loadAttempts()
    expect(attemptsMock).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('需要请求诊断权限')
    wrapper.unmount()
  })
  it('virtualizes 98 loaded tool definitions and multi-megabyte raw content', async () => {
    contentMock.mockImplementation(async (_id, params) =>
      params.view === 'raw'
        ? pageResult([{ ...messageItem, text: 'fixture raw line\n'.repeat(130000) }])
        : pageResult(
            Array.from({ length: 98 }, (_, i) => ({
              ...messageItem,
              section: 'tools',
              locator: 'tool-' + i,
              label: 'tool-' + i,
              text: '',
            })),
          ),
    )
    const wrapper = mountView()
    await flushPromises()
    ;(wrapper.vm as any).openDetail(row)
    await flushPromises()
    expect(wrapper.findAll('[data-testid="parsed-item"]').length).toBeLessThan(20)
    const detail = wrapper.findComponent(AIRequestLogDetail)
    ;(detail.vm as any).view = 'raw'
    await flushPromises()
    expect(wrapper.findAll('.raw-line').length).toBeLessThan(30)
    wrapper.unmount()
  })
  it('full-load uses subsequent pages and actually loads collapsed item contents', async () => {
    contentMock.mockImplementation(async (_id, params) =>
      params.view === 'raw'
        ? pageResult([{ ...messageItem, text: 'full tool schema' }])
        : params.cursor
          ? pageResult([{ ...messageItem, locator: 'WzFd' }], { totalItems: 2 })
          : pageResult([messageItem], { totalItems: 2, hasMore: true, nextCursor: 'next-page' }),
    )
    const wrapper = mountView()
    await flushPromises()
    ;(wrapper.vm as any).openDetail(row)
    await flushPromises()
    const reader = wrapper.findComponent(AIRequestLogReader)
    ;(reader.vm as any).loadAll = true
    for (let i = 0; i < 6; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5))
      await flushPromises()
    }
    expect(contentMock.mock.calls.some((call) => call[1].cursor === 'next-page')).toBe(true)
    expect(contentMock.mock.calls.filter((call) => call[1].view === 'raw')).toHaveLength(2)
    expect((reader.vm as any).allComplete).toBe(true)
    wrapper.unmount()
  })
  it('opens JSON children without loading their whole raw body', async () => {
    contentMock.mockResolvedValue(
      pageResult([{ ...messageItem, section: 'parameters', expandable: true }]),
    )
    const wrapper = mountView()
    await flushPromises()
    ;(wrapper.vm as any).openDetail(row)
    await flushPromises()
    const button = wrapper.findAll('button').find((node) => node.text() === '逐层展开结构')!
    await button.trigger('click')
    await flushPromises()
    expect(contentMock.mock.calls.at(-1)?.[1]).toMatchObject({ view: 'parsed', locator: 'WzBd' })
    wrapper.unmount()
  })
  it('locates attempt errors beyond the first attempt page', async () => {
    canReadAttemptsMock.mockReturnValue(true)
    attemptsMock.mockImplementation(async (_id, params) => ({
      items: params.cursor
        ? [
            {
              sequence: 21,
              stage: 'upstream',
              success: false,
              statusCode: 503,
              durationMs: 1,
              errorExcerpt: 'needle',
              errorTruncated: false,
            },
          ]
        : Array.from({ length: 20 }, (_, i) => ({
            sequence: i + 1,
            stage: 'upstream',
            success: true,
            statusCode: 200,
            durationMs: 1,
            errorExcerpt: null,
            errorTruncated: false,
          })),
      total: 21,
      hasMore: !params.cursor,
      nextCursor: params.cursor ? null : 'attempt-next',
      truncated: false,
    }))
    const wrapper = mountView()
    await flushPromises()
    ;(wrapper.vm as any).openDetail(row)
    await flushPromises()
    await (wrapper.findComponent(AIRequestLogDetail).vm as any).locate({
      side: 'attempts',
      path: '/20/errorExcerpt',
      locator: 'opaque',
      offset: 0,
    })
    await flushPromises()
    expect(attemptsMock).toHaveBeenCalledTimes(2)
    expect(wrapper.find('.focused-attempt').attributes('data-sequence')).toBe('21')
    wrapper.unmount()
  })
  it('rejects invalid filters and preserves valid filters across pagination', async () => {
    const wrapper = mountView()
    await flushPromises()
    const vm = wrapper.vm as any
    vm.filters.minDurationMs = '100'
    vm.filters.maxDurationMs = '20'
    await vm.load()
    expect(listMock).toHaveBeenCalledTimes(1)
    vm.filters.maxDurationMs = '200'
    vm.filters.user = 'alice'
    vm.page = 2
    await vm.load()
    expect(listMock.mock.calls.at(-1)?.[0]).toMatchObject({
      page: 2,
      user: 'alice',
      minDurationMs: 100,
      maxDurationMs: 200,
    })
    wrapper.unmount()
  })
  it('ignores stale metadata when quickly switching requests', async () => {
    let resolveOld: (value: unknown) => void = () => {}
    metadataMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve
        }),
    )
    const wrapper = mountView()
    await flushPromises()
    ;(wrapper.vm as any).openDetail(row)
    await flushPromises()
    ;(wrapper.vm as any).openDetail({ ...row, id: 'log-2', username: 'new-user' })
    await flushPromises()
    resolveOld({ ...row, username: 'stale-user', availableSides: [] })
    await flushPromises()
    expect(wrapper.text()).not.toContain('stale-user')
    wrapper.unmount()
  })
})
