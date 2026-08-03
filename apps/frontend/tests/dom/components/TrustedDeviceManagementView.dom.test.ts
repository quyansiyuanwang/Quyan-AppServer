// @vitest-environment jsdom
import { defineComponent, nextTick } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { i18ns } from '@/locales'

const {
  listTrustedDevicesMock,
  removeTrustedDeviceMock,
  messageErrorMock,
  messageSuccessMock,
  confirmMock,
} = vi.hoisted(() => ({
  listTrustedDevicesMock: vi.fn(),
  removeTrustedDeviceMock: vi.fn(),
  messageErrorMock: vi.fn(),
  messageSuccessMock: vi.fn(),
  confirmMock: vi.fn(),
}))

vi.mock('@/service/twoFactor/trustedDeviceService', () => ({
  trustedDeviceService: {
    listTrustedDevices: listTrustedDevicesMock,
    removeTrustedDevice: removeTrustedDeviceMock,
  },
}))

vi.mock('@/composables/usePageDevice', async () => {
  const { ref } = await import('vue')
  return {
    usePageDevice: () => ({
      isDesktop: ref(true),
      isMobile: ref(false),
    }),
  }
})

vi.mock('@/composables/usePagination', async () => {
  const { computed, ref } = await import('vue')
  return {
    usePagination: ({ initialPage = 1, initialPageSize = 10 } = {}) => {
      const page = ref(initialPage)
      const pageSize = ref(initialPageSize)
      const total = ref(0)
      const loading = ref(false)

      let latestRequestId = 0
      let activeController: AbortController | null = null

      const maxPage = computed(() => Math.max(1, Math.ceil(total.value / Math.max(1, pageSize.value))))

      const setPage = (nextPage: number) => {
        const normalized = Number.isFinite(nextPage) ? Math.floor(nextPage) : 1
        page.value = Math.max(1, Math.min(maxPage.value, normalized))
      }

      const setPageSize = (nextPageSize: number) => {
        const normalized = Number.isFinite(nextPageSize) ? Math.floor(nextPageSize) : initialPageSize
        pageSize.value = Math.max(1, normalized)
      }

      const applyResult = (result: { page?: number; pageSize?: number; total?: number }) => {
        if (typeof result.total === 'number') total.value = Math.max(0, Math.floor(result.total))
        if (typeof result.pageSize === 'number') setPageSize(result.pageSize)
        if (typeof result.page === 'number') setPage(result.page)
      }

      const recalculatePageByTotal = (nextTotal?: number) => {
        if (typeof nextTotal === 'number') total.value = Math.max(0, Math.floor(nextTotal))
        page.value = Math.min(page.value, maxPage.value)
        return page.value
      }

      const resetToFirstPage = () => {
        page.value = 1
      }

      const beginRequest = () => {
        latestRequestId += 1
        activeController?.abort()
        const controller = new AbortController()
        activeController = controller
        loading.value = true

        return {
          requestId: latestRequestId,
          signal: controller.signal,
          controller,
        }
      }

      const isRequestCurrent = (requestId: number) => requestId === latestRequestId

      const finalizeRequest = (ctx: { requestId: number; controller: AbortController }) => {
        if (!isRequestCurrent(ctx.requestId)) return
        if (activeController === ctx.controller) activeController = null
        loading.value = false
      }

      const cancelRequest = () => {
        latestRequestId += 1
        activeController?.abort()
        activeController = null
        loading.value = false
      }

      return {
        loading,
        page,
        pageSize,
        total,
        setPage,
        resetToFirstPage,
        applyResult,
        recalculatePageByTotal,
        beginRequest,
        isRequestCurrent,
        finalizeRequest,
        cancelRequest,
      }
    },
  }
})

vi.mock('element-plus', () => ({
  ElMessage: {
    error: messageErrorMock,
    success: messageSuccessMock,
  },
  ElMessageBox: {
    confirm: confirmMock,
  },
}))

import TrustedDeviceManagementView from '@/views/settings/TrustedDeviceManagementView.vue'

const ElCardStub = defineComponent({
  name: 'ElCardStub',
  template: `
    <section class="el-card-stub">
      <header class="el-card-header"><slot name="header" /></header>
      <div class="el-card-body"><slot /></div>
    </section>
  `,
})

const ElButtonStub = defineComponent({
  name: 'ElButtonStub',
  props: {
    loading: {
      type: Boolean,
      default: false,
    },
  },
  emits: ['click'],
  template: `
    <button class="el-button-stub" :disabled="loading" @click="$emit('click')">
      <slot />
    </button>
  `,
})

const ElAlertStub = defineComponent({
  name: 'ElAlertStub',
  props: {
    title: {
      type: String,
      default: '',
    },
  },
  template: '<div class="el-alert-stub">{{ title }}</div>',
})

const ElSkeletonStub = defineComponent({
  name: 'ElSkeletonStub',
  template: '<div class="el-skeleton-stub"><slot /></div>',
})

const ElEmptyStub = defineComponent({
  name: 'ElEmptyStub',
  props: {
    description: {
      type: String,
      default: '',
    },
  },
  template: '<div class="el-empty-stub">{{ description }}</div>',
})

const ElPaginationStub = defineComponent({
  name: 'ElPaginationStub',
  props: {
    currentPage: {
      type: Number,
      default: 1,
    },
    disabled: {
      type: Boolean,
      default: false,
    },
  },
  emits: ['current-change'],
  template: `
    <button
      class="el-pagination-stub"
      :disabled="disabled"
      @click="$emit('current-change', currentPage + 1)"
    >
      next
    </button>
  `,
})

const mountView = () =>
  mount(TrustedDeviceManagementView, {
    global: {
      stubs: {
        'el-card': ElCardStub,
        'el-button': ElButtonStub,
        'el-alert': ElAlertStub,
        'el-skeleton': ElSkeletonStub,
        'el-empty': ElEmptyStub,
        'el-pagination': ElPaginationStub,
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

const device = {
  deviceId: 'a'.repeat(64),
  ipAddress: '203.0.113.8',
  userAgent: 'Mozilla/5.0',
  fingerprint: 'fp-1',
  trustedAt: '2026-04-13T08:00:00.000Z',
  lastUsedAt: '2026-04-13T09:00:00.000Z',
  expiresInSeconds: 600,
}

const createPage = (overrides: Record<string, unknown> = {}) => ({
  devices: [device],
  total: 1,
  page: 1,
  pageSize: 10,
  hasMore: false,
  ...overrides,
})

describe('TrustedDeviceManagementView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    confirmMock.mockResolvedValue(undefined)
  })

  it('loads and renders trusted devices on mount', async () => {
    listTrustedDevicesMock.mockResolvedValueOnce(createPage())

    const wrapper = mountView()
    await flushPromises()

    expect(listTrustedDevicesMock).toHaveBeenCalledTimes(1)
    expect(listTrustedDevicesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 1,
        pageSize: 10,
        signal: expect.any(AbortSignal),
      }),
    )
    expect(wrapper.text()).toContain(device.ipAddress)
    expect(wrapper.text()).toContain(device.userAgent)
    expect(wrapper.text()).toContain(i18ns.t('twoFactor.trustedDeviceLastUsedAt'))
  })

  it('shows retry action on load error and retries successfully', async () => {
    listTrustedDevicesMock
      .mockRejectedValueOnce(new Error('load failed'))
      .mockResolvedValueOnce(createPage())

    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.find('.trusted-error-retry').exists()).toBe(true)
    expect(messageErrorMock).toHaveBeenCalledWith('load failed')

    await wrapper.find('.trusted-error-retry').trigger('click')
    await flushPromises()

    expect(listTrustedDevicesMock).toHaveBeenCalledTimes(2)
    expect(wrapper.find('.trusted-error-retry').exists()).toBe(false)
  })

  it('shows pagination loading status text while page request is in flight', async () => {
    const secondPageDeferred = createDeferred<ReturnType<typeof createPage>>()

    listTrustedDevicesMock.mockResolvedValueOnce(createPage({ total: 22, hasMore: true }))
    listTrustedDevicesMock.mockImplementationOnce(() => secondPageDeferred.promise)

    const wrapper = mountView()
    await flushPromises()

    await wrapper.find('.el-pagination-stub').trigger('click')
    await nextTick()

    const status = wrapper.find('.trusted-pagination-loading')
    expect(status.exists()).toBe(true)
    expect(status.attributes('role')).toBe('status')
    expect(status.text()).toContain(i18ns.t('twoFactor.trustedDevicesPageLoading'))

    secondPageDeferred.resolve(createPage({ page: 2, total: 22, hasMore: false }))
    await flushPromises()

    expect(wrapper.find('.trusted-pagination-loading').exists()).toBe(false)
  })

  it('marks skeleton region as polite live region while loading', async () => {
    const deferred = createDeferred<ReturnType<typeof createPage>>()
    listTrustedDevicesMock.mockImplementationOnce(() => deferred.promise)

    const wrapper = mountView()
    await nextTick()

    const region = wrapper.find('.trusted-skeleton-region')
    expect(region.exists()).toBe(true)
    expect(region.attributes('aria-live')).toBe('polite')
    expect(region.attributes('aria-busy')).toBe('true')

    deferred.resolve(createPage())
    await flushPromises()

    expect(wrapper.find('.trusted-skeleton-region').attributes('aria-live')).toBe('off')
    expect(wrapper.find('.trusted-skeleton-region').attributes('aria-busy')).toBe('false')
  })

  it('renders unknown for negative expires and humanized duration labels for valid values', async () => {
    listTrustedDevicesMock.mockResolvedValueOnce(
      createPage({
        devices: [
          {
            ...device,
            expiresInSeconds: -1,
          },
          {
            ...device,
            deviceId: 'b'.repeat(64),
            expiresInSeconds: 0,
          },
          {
            ...device,
            deviceId: 'c'.repeat(64),
            expiresInSeconds: 3661,
          },
        ],
      }),
    )

    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.text()).toContain(i18ns.t('twoFactor.trustedDeviceUnknown'))
    expect(wrapper.text()).toContain(i18ns.t('twoFactor.trustedDeviceExpiresSoon'))
    expect(wrapper.text()).toContain(i18ns.t('twoFactor.trustedDeviceDurationHours', { count: 1 }))
    expect(wrapper.text()).toContain(i18ns.t('twoFactor.trustedDeviceDurationMinutes', { count: 1 }))
  })

  it('aborts active trusted-device request on unmount', async () => {
    const deferred = createDeferred<ReturnType<typeof createPage>>()
    listTrustedDevicesMock.mockImplementationOnce(() => deferred.promise)

    const wrapper = mountView()
    await nextTick()

    const loadOptions = listTrustedDevicesMock.mock.calls[0]?.[0] as {
      signal?: AbortSignal
    }

    expect(loadOptions.signal).toBeDefined()

    wrapper.unmount()

    expect(loadOptions.signal?.aborted).toBe(true)

    deferred.resolve(createPage())
    await flushPromises()
  })

  it('removes trusted device after confirmation and reloads list', async () => {
    listTrustedDevicesMock.mockResolvedValueOnce(createPage())
    listTrustedDevicesMock.mockResolvedValueOnce(
      createPage({
        devices: [],
        total: 0,
        hasMore: false,
      }),
    )
    removeTrustedDeviceMock.mockResolvedValueOnce(true)

    const wrapper = mountView()
    await flushPromises()

    await wrapper.find('.delete-btn').trigger('click')
    await flushPromises()

    expect(confirmMock).toHaveBeenCalledTimes(1)
    expect(removeTrustedDeviceMock).toHaveBeenCalledWith(device.deviceId)
    expect(messageErrorMock).not.toHaveBeenCalled()
    expect(messageSuccessMock).toHaveBeenCalledWith(i18ns.t('twoFactor.trustedDeviceDeleteSuccess'))
    expect(listTrustedDevicesMock).toHaveBeenCalledTimes(2)
  })
})
