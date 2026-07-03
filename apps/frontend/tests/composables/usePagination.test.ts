import { effectScope, type EffectScope } from 'vue'
import { describe, expect, it } from 'vitest'
import { usePagination } from '@/composables/usePagination'

const createPagination = (options?: Parameters<typeof usePagination>[0]) => {
  let scope: EffectScope | null = effectScope()
  let pagination: ReturnType<typeof usePagination> | null = null

  scope.run(() => {
    pagination = usePagination(options)
  })

  if (!pagination) throw new Error('Failed to initialize pagination composable')

  return {
    pagination,
    dispose: () => {
      scope?.stop()
      scope = null
    },
  }
}

describe('usePagination', () => {
  it('clamps page and page size within configured bounds', () => {
    const { pagination, dispose } = createPagination({
      initialPage: 1,
      initialPageSize: 10,
      bounds: {
        pageSizeMin: 5,
        pageSizeMax: 20,
        pageSizeDefault: 10,
      },
    })

    pagination.setTotal(200)

    pagination.setPage(999)
    expect(pagination.page.value).toBe(20)

    pagination.setPage(-1)
    expect(pagination.page.value).toBe(1)

    pagination.setPageSize(999)
    expect(pagination.pageSize.value).toBe(20)

    pagination.setPageSize(1)
    expect(pagination.pageSize.value).toBe(5)

    dispose()
  })

  it('applies pagination result payload safely', () => {
    const { pagination, dispose } = createPagination()

    pagination.applyResult({
      page: 3,
      pageSize: 15,
      total: 80,
    })

    expect(pagination.page.value).toBe(3)
    expect(pagination.pageSize.value).toBe(15)
    expect(pagination.total.value).toBe(80)

    dispose()
  })

  it('handles request lifecycle with abort + loading state', () => {
    const { pagination, dispose } = createPagination()

    const first = pagination.beginRequest()
    expect(pagination.loading.value).toBe(true)
    expect(first.signal.aborted).toBe(false)

    const second = pagination.beginRequest()
    expect(first.signal.aborted).toBe(true)
    expect(pagination.isRequestCurrent(first.requestId)).toBe(false)
    expect(pagination.isRequestCurrent(second.requestId)).toBe(true)

    pagination.finalizeRequest(first)
    expect(pagination.loading.value).toBe(true)

    pagination.finalizeRequest(second)
    expect(pagination.loading.value).toBe(false)

    dispose()
  })

  it('cancels active request and clears loading', () => {
    const { pagination, dispose } = createPagination()

    const context = pagination.beginRequest()
    expect(pagination.loading.value).toBe(true)

    pagination.cancelRequest()

    expect(context.signal.aborted).toBe(true)
    expect(pagination.loading.value).toBe(false)

    dispose()
  })
})
