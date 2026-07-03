import { computed, onScopeDispose, ref } from 'vue'

export interface PaginationBounds {
  pageMin: number
  pageSizeMin: number
  pageSizeMax: number
  pageSizeDefault: number
}

export interface PaginationResultLike {
  page?: number
  pageSize?: number
  total?: number
}

interface UsePaginationOptions {
  initialPage?: number
  initialPageSize?: number
  bounds?: Partial<PaginationBounds>
}

export interface PaginationRequestContext {
  requestId: number
  signal: AbortSignal
  controller: AbortController
}

const DEFAULT_BOUNDS: PaginationBounds = {
  pageMin: 1,
  pageSizeMin: 1,
  pageSizeMax: 50,
  pageSizeDefault: 10,
}

const toPositiveInt = (value: unknown, fallback: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(1, Math.floor(value))
}

export function usePagination(options: UsePaginationOptions = {}) {
  const bounds = ref<PaginationBounds>({
    ...DEFAULT_BOUNDS,
    ...options.bounds,
  })

  const page = ref(toPositiveInt(options.initialPage, bounds.value.pageMin))
  const pageSize = ref(
    Math.min(
      bounds.value.pageSizeMax,
      Math.max(
        bounds.value.pageSizeMin,
        toPositiveInt(options.initialPageSize, bounds.value.pageSizeDefault),
      ),
    ),
  )
  const total = ref(0)
  const loading = ref(false)

  let latestRequestId = 0
  let activeController: AbortController | null = null

  const maxPage = computed(() => {
    const safePageSize = Math.max(1, pageSize.value)
    return Math.max(bounds.value.pageMin, Math.ceil(Math.max(0, total.value) / safePageSize))
  })

  const clampPage = (nextPage: number): number => {
    const normalized = toPositiveInt(nextPage, bounds.value.pageMin)
    return Math.max(bounds.value.pageMin, Math.min(maxPage.value, normalized))
  }

  const clampPageSize = (nextPageSize: number): number => {
    const normalized = toPositiveInt(nextPageSize, bounds.value.pageSizeDefault)
    return Math.max(bounds.value.pageSizeMin, Math.min(bounds.value.pageSizeMax, normalized))
  }

  const setPage = (nextPage: number): number => {
    page.value = clampPage(nextPage)
    return page.value
  }

  const setPageSize = (nextPageSize: number): number => {
    pageSize.value = clampPageSize(nextPageSize)
    page.value = clampPage(page.value)
    return pageSize.value
  }

  const setTotal = (nextTotal: number): number => {
    total.value = Math.max(0, Math.floor(Number.isFinite(nextTotal) ? nextTotal : 0))
    page.value = clampPage(page.value)
    return total.value
  }

  const setBounds = (nextBounds: Partial<PaginationBounds>): PaginationBounds => {
    const nextMin = toPositiveInt(nextBounds.pageMin, bounds.value.pageMin)
    const nextPageSizeMin = toPositiveInt(nextBounds.pageSizeMin, bounds.value.pageSizeMin)
    const nextPageSizeMax = Math.max(
      nextPageSizeMin,
      toPositiveInt(nextBounds.pageSizeMax, bounds.value.pageSizeMax),
    )
    const nextPageSizeDefault = Math.min(
      nextPageSizeMax,
      Math.max(
        nextPageSizeMin,
        toPositiveInt(nextBounds.pageSizeDefault, bounds.value.pageSizeDefault),
      ),
    )

    bounds.value = {
      pageMin: nextMin,
      pageSizeMin: nextPageSizeMin,
      pageSizeMax: nextPageSizeMax,
      pageSizeDefault: nextPageSizeDefault,
    }

    setPageSize(pageSize.value)
    setPage(page.value)
    return bounds.value
  }

  const resetToFirstPage = () => {
    page.value = bounds.value.pageMin
  }

  const applyResult = (result: PaginationResultLike): void => {
    if (typeof result.total === 'number') setTotal(result.total)
    if (typeof result.pageSize === 'number') setPageSize(result.pageSize)
    if (typeof result.page === 'number') setPage(result.page)
  }

  const recalculatePageByTotal = (nextTotal?: number): number => {
    if (typeof nextTotal === 'number') setTotal(nextTotal)
    page.value = clampPage(page.value)
    return page.value
  }

  const beginRequest = (): PaginationRequestContext => {
    const requestId = ++latestRequestId

    activeController?.abort()
    const controller = new AbortController()
    activeController = controller
    loading.value = true

    return {
      requestId,
      signal: controller.signal,
      controller,
    }
  }

  const isRequestCurrent = (requestId: number): boolean => requestId === latestRequestId

  const finalizeRequest = (context: PaginationRequestContext): void => {
    if (!isRequestCurrent(context.requestId)) return
    if (activeController === context.controller) activeController = null
    loading.value = false
  }

  const cancelRequest = (): void => {
    latestRequestId += 1
    activeController?.abort()
    activeController = null
    loading.value = false
  }

  onScopeDispose(() => {
    cancelRequest()
  })

  return {
    bounds,
    page,
    pageSize,
    total,
    loading,
    maxPage,
    clampPage,
    clampPageSize,
    setPage,
    setPageSize,
    setTotal,
    setBounds,
    resetToFirstPage,
    applyResult,
    recalculatePageByTotal,
    beginRequest,
    isRequestCurrent,
    finalizeRequest,
    cancelRequest,
  }
}
