// @vitest-environment jsdom
import { computed, defineComponent, inject, provide, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { i18ns } from '@/locales'

const {
  getBusinessLogsMock,
  getBusinessLogStatsMock,
  getBusinessLogFilterOptionsMock,
  messageErrorMock,
  messageWarningMock,
} = vi.hoisted(() => ({
  getBusinessLogsMock: vi.fn(),
  getBusinessLogStatsMock: vi.fn(),
  getBusinessLogFilterOptionsMock: vi.fn(),
  messageErrorMock: vi.fn(),
  messageWarningMock: vi.fn(),
}))

vi.mock('@/service/systemService', () => ({
  default: {
    getBusinessLogs: getBusinessLogsMock,
    getBusinessLogStats: getBusinessLogStatsMock,
    getBusinessLogFilterOptions: getBusinessLogFilterOptionsMock,
  },
}))

vi.mock('@/composables/usePageDevice', () => ({
  usePageDevice: () => ({
    isDesktop: true,
    isMobile: false,
  }),
}))

vi.mock('element-plus', () => ({
  ElMessage: {
    error: messageErrorMock,
    warning: messageWarningMock,
  },
}))

vi.mock('@element-plus/icons-vue', () => ({
  Refresh: defineComponent({ name: 'RefreshIcon', template: '<span />' }),
}))

vi.mock('@/utils/asyncChart', () => ({
  AsyncVChart: defineComponent({
    name: 'AsyncVChartStub',
    template: '<div class="async-vchart-stub"></div>',
  }),
}))

import BusinessLogsView from '@/views/system/BusinessLogsView.vue'

const ElCardStub = defineComponent({
  name: 'ElCardStub',
  template: '<div class="el-card-stub"><slot name="header" /><slot /></div>',
})

const ElButtonStub = defineComponent({
  name: 'ElButtonStub',
  emits: ['click'],
  template: '<button class="el-button-stub" @click="$emit(\'click\')"><slot /></button>',
})

const ElFormStub = defineComponent({
  name: 'ElFormStub',
  template: '<form class="el-form-stub"><slot /></form>',
})

const ElFormItemStub = defineComponent({
  name: 'ElFormItemStub',
  template: '<div class="el-form-item-stub"><slot /></div>',
})

const ElSelectStub = defineComponent({
  name: 'ElSelectStub',
  template: '<div class="el-select-stub"><slot /></div>',
})

const ElOptionStub = defineComponent({
  name: 'ElOptionStub',
  props: {
    label: { type: String, default: '' },
    value: { type: [String, Number, Boolean], default: undefined },
  },
  template: '<div class="el-option-stub">{{ label }}</div>',
})

const ElInputStub = defineComponent({
  name: 'ElInputStub',
  props: {
    modelValue: { type: String, default: '' },
  },
  emits: ['update:modelValue', 'change'],
  template: '<input class="el-input-stub" :value="modelValue" />',
})

const ElDatePickerStub = defineComponent({
  name: 'ElDatePickerStub',
  props: {
    modelValue: { type: Array, default: null },
  },
  emits: ['update:modelValue', 'change'],
  template: '<div class="el-date-picker-stub"></div>',
})

const ElTableStub = defineComponent({
  name: 'ElTableStub',
  props: {
    data: { type: Array, default: () => [] },
  },
  setup(props) {
    provide('tableRows', computed(() => props.data as any[]))
  },
  template: '<div class="el-table-stub"><slot /></div>',
})

const ElTableColumnStub = defineComponent({
  name: 'ElTableColumnStub',
  setup() {
    const rows = inject<any>('tableRows', ref([]))
    return { rows }
  },
  template:
    '<div class="el-table-column-stub"><template v-for="(row, index) in rows" :key="index"><slot :row="row" /></template></div>',
})

const ElTagStub = defineComponent({
  name: 'ElTagStub',
  template: '<span class="el-tag-stub"><slot /></span>',
})

const ElPaginationStub = defineComponent({
  name: 'ElPaginationStub',
  template: '<div class="el-pagination-stub"></div>',
})

const ElCollapseStub = defineComponent({
  name: 'ElCollapseStub',
  template: '<div class="el-collapse-stub"><slot /></div>',
})

const ElCollapseItemStub = defineComponent({
  name: 'ElCollapseItemStub',
  template: '<div class="el-collapse-item-stub"><slot /></div>',
})

const ElAlertStub = defineComponent({
  name: 'ElAlertStub',
  template: '<div class="el-alert-stub"><slot /></div>',
})

const ElSkeletonStub = defineComponent({
  name: 'ElSkeletonStub',
  template: '<div class="el-skeleton-stub"><slot /></div>',
})

const ElEmptyStub = defineComponent({
  name: 'ElEmptyStub',
  template: '<div class="el-empty-stub"></div>',
})

const mountView = () =>
  mount(BusinessLogsView, {
    global: {
      directives: {
        loading: {},
      },
      stubs: {
        'el-card': ElCardStub,
        'el-button': ElButtonStub,
        'el-form': ElFormStub,
        'el-form-item': ElFormItemStub,
        'el-select': ElSelectStub,
        'el-option': ElOptionStub,
        'el-input': ElInputStub,
        'el-date-picker': ElDatePickerStub,
        'el-table': ElTableStub,
        'el-table-column': ElTableColumnStub,
        'el-tag': ElTagStub,
        'el-pagination': ElPaginationStub,
        'el-collapse': ElCollapseStub,
        'el-collapse-item': ElCollapseItemStub,
        'el-alert': ElAlertStub,
        'el-skeleton': ElSkeletonStub,
        'el-empty': ElEmptyStub,
      },
    },
  })

const createDeferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void

  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, resolve, reject }
}

const createLogPage = (id: string, total = 1) => ({
  logs: [
    {
      id,
      operationType: 'USER_LOGIN',
      operationCategory: 'AUTH',
      actorUsername: 'alice',
      description: `log-${id}`,
      success: true,
      ipAddress: '127.0.0.1',
      createTime: '2026-05-05T12:00:00.000Z',
      targetUsername: null,
      targetUserId: null,
      targetResourceId: null,
      targetResourceType: null,
      changes: null,
      metadata: null,
      errorMessage: null,
      requestId: null,
      userAgent: null,
    },
  ],
  total,
  page: 1,
  pageSize: 10,
})

const createStatsResponse = () => ({
  range: {
    startDate: '2026-05-01T00:00:00.000Z',
    endDate: '2026-05-02T00:00:00.000Z',
    days: 2,
  },
  summary: {
    totalLogs: 1,
    successLogs: 1,
    failedLogs: 0,
    uniqueActors: 1,
    systemTriggeredLogs: 0,
    uniqueTargets: 0,
    uniqueIPs: 1,
  },
  daily: [],
  byOperationType: [],
  byOperationCategory: [],
  bySuccess: [],
  operationTypeDailyDistribution: [],
  categoryDailyDistribution: [],
  generatedAt: '2026-05-02T00:00:00.000Z',
})

describe('BusinessLogsView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getBusinessLogFilterOptionsMock.mockResolvedValue({
      operationTypes: [],
      operationCategories: [],
    })
    getBusinessLogsMock.mockResolvedValue(createLogPage('initial'))
    getBusinessLogStatsMock.mockResolvedValue(createStatsResponse())
  })

  it('keeps the latest date-range result when earlier requests resolve later', async () => {
    const firstDeferred = createDeferred<any>()
    const secondDeferred = createDeferred<any>()

    const wrapper = mountView()
    await flushPromises()

    const vm = wrapper.vm as any

    getBusinessLogsMock
      .mockImplementationOnce((_page: number, _pageSize: number, _filters: any, signal?: AbortSignal) => {
        expect(signal).toBeInstanceOf(AbortSignal)
        return firstDeferred.promise
      })
      .mockImplementationOnce((_page: number, _pageSize: number, _filters: any, signal?: AbortSignal) => {
        expect(signal).toBeInstanceOf(AbortSignal)
        return secondDeferred.promise
      })

    vm.handleDateRangeChange([
      new Date('2026-05-01T00:00:00.000Z'),
      new Date('2026-05-02T00:00:00.000Z'),
    ])
    vm.handleDateRangeChange([
      new Date('2026-05-03T00:00:00.000Z'),
      new Date('2026-05-04T00:00:00.000Z'),
    ])

    secondDeferred.resolve(createLogPage('latest', 2))
    await flushPromises()

    expect(vm.logs).toHaveLength(1)
    expect(vm.logs[0].id).toBe('latest')
    expect(vm.total).toBe(2)

    firstDeferred.resolve(createLogPage('stale', 9))
    await flushPromises()

    expect(vm.logs).toHaveLength(1)
    expect(vm.logs[0].id).toBe('latest')
    expect(vm.total).toBe(2)
    expect(vm.loading).toBe(false)
  })

  it('does not clear loading when a stale request finishes before the latest one', async () => {
    const firstDeferred = createDeferred<any>()
    const secondDeferred = createDeferred<any>()

    const wrapper = mountView()
    await flushPromises()

    const vm = wrapper.vm as any

    getBusinessLogsMock
      .mockImplementationOnce(() => firstDeferred.promise)
      .mockImplementationOnce(() => secondDeferred.promise)

    vm.handleDateRangeChange([
      new Date('2026-05-01T00:00:00.000Z'),
      new Date('2026-05-02T00:00:00.000Z'),
    ])
    vm.handleDateRangeChange([
      new Date('2026-05-03T00:00:00.000Z'),
      new Date('2026-05-04T00:00:00.000Z'),
    ])

    expect(vm.loading).toBe(true)

    firstDeferred.resolve(createLogPage('stale'))
    await flushPromises()

    expect(vm.loading).toBe(true)

    secondDeferred.resolve(createLogPage('latest'))
    await flushPromises()

    expect(vm.loading).toBe(false)
    expect(vm.logs[0].id).toBe('latest')
  })

  it('reverts invalid date ranges to the last valid selection without reloading', async () => {
    const wrapper = mountView()
    await flushPromises()

    const vm = wrapper.vm as any

    vm.handleDateRangeChange([
      new Date('2026-05-01T00:00:00.000Z'),
      new Date('2026-05-02T00:00:00.000Z'),
    ])
    await flushPromises()

    const callCountAfterValidRange = getBusinessLogsMock.mock.calls.length
    const previousStartDate = vm.filters.startDate
    const previousEndDate = vm.filters.endDate

    vm.handleDateRangeChange([
      new Date('2026-05-01T00:00:00.000Z'),
      new Date('2026-06-15T00:00:00.000Z'),
    ])
    await flushPromises()

    expect(messageWarningMock).toHaveBeenCalledWith(
      i18ns.t('BusinessLogs.dateRangeLimit', { days: 30 }),
    )
    expect(getBusinessLogsMock).toHaveBeenCalledTimes(callCountAfterValidRange)
    expect(vm.filters.startDate).toBe(previousStartDate)
    expect(vm.filters.endDate).toBe(previousEndDate)
    expect(vm.dateRange).not.toBeNull()
    expect(vm.dateRange[0].toISOString()).toBe('2026-05-01T00:00:00.000Z')
    expect(vm.dateRange[1].toISOString()).toBe('2026-05-02T00:00:00.000Z')
  })
})