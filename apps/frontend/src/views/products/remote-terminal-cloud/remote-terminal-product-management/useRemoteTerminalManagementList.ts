import { ref, shallowRef } from 'vue'
import { usePagination } from '@/composables/usePagination'

const LIST_PAGINATION = { pageSizeDefault: 20, pageSizeMax: 100 }
type Page<T> = { records: T[]; total: number; page: number; pageSize: number }
/** Retain only the latest admitted server page; identity changes invalidate both rows and totals. */
export function useRemoteTerminalManagementList<T extends { id: string }>(
  source: (pagination: { page: number; pageSize: number }) => Promise<Page<T>>,
  identity: () => string,
  permitted: () => boolean,
) {
  const pagination = usePagination({ bounds: LIST_PAGINATION })
  const records = shallowRef<T[]>([]),
    failed = ref(false)
  const clear = () => {
    records.value = []
    pagination.total.value = 0
  }
  const reset = () => {
    pagination.cancelRequest()
    clear()
    pagination.resetToFirstPage()
    failed.value = false
  }
  const load = async () => {
    if (!permitted()) {
      reset()
      return false
    }
    const attempt = pagination.beginRequest(),
      owner = identity(),
      pageSize = pagination.pageSize.value
    const current = () =>
      pagination.isRequestCurrent(attempt.requestId) && owner === identity() && permitted()
    let page = pagination.page.value
    clear()
    failed.value = false
    try {
      for (let adjustment = 0; adjustment < 2; adjustment++) {
        const result = await source({ page, pageSize })
        if (!current()) return false
        if (
          result.page !== page ||
          result.pageSize !== pageSize ||
          !Number.isSafeInteger(result.total) ||
          result.total < 0 ||
          !Array.isArray(result.records) ||
          result.records.length > pageSize ||
          new Set(result.records.map((row) => row.id)).size !== result.records.length ||
          result.records.some((row) => !row.id || typeof row.id !== 'string') ||
          (result.records.length && result.total < (page - 1) * pageSize + result.records.length)
        )
          throw new Error('Invalid management page')
        const lastPage = Math.max(1, Math.ceil(result.total / pageSize))
        if (page > lastPage) {
          if (adjustment) throw new Error('Management pagination changed repeatedly')
          page = lastPage
          pagination.page.value = page
          continue
        }
        if (
          result.records.length !==
          Math.min(pageSize, Math.max(0, result.total - (page - 1) * pageSize))
        )
          throw new Error('Incomplete management page')
        pagination.applyResult(result)
        records.value = result.records
        return true
      }
      return false
    } catch {
      if (current()) {
        clear()
        failed.value = true
      }
      return false
    } finally {
      if (pagination.isRequestCurrent(attempt.requestId) && (owner !== identity() || !permitted()))
        reset()
      pagination.finalizeRequest(attempt)
    }
  }
  const reloadFirst = async () => {
    pagination.resetToFirstPage()
    return load()
  }
  const changePage = async (page: number) => {
    pagination.setPage(page)
    return load()
  }
  const changePageSize = async (pageSize: number) => {
    pagination.setPageSize(pageSize)
    return reloadFirst()
  }
  return { ...pagination, records, failed, reset, load, reloadFirst, changePage, changePageSize }
}
