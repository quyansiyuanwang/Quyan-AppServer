import { ref, shallowRef } from 'vue'
import { IAM_MANAGEMENT_PAGINATION, type IamManagementPageResult } from '@quyan/shared'

/** Pages remain navigable after IAM filtering, including empty candidate pages. */
export function useIamManagementPage<T>(
  fetch: (query: { page: number; pageSize: number }) => Promise<IamManagementPageResult<T>>,
) {
  const page = ref(1)
  const pageSize = ref<number>(IAM_MANAGEMENT_PAGINATION.defaultPageSize)
  const items = shallowRef<T[]>([])
  const hasNext = ref(false)
  const loading = ref(false)
  const failed = ref(false)
  let sequence = 0
  const clear = () => {
    sequence++
    page.value = 1
    items.value = []
    hasNext.value = false
    loading.value = false
    failed.value = false
  }
  const load = async (targetPage = page.value) => {
    const ticket = ++sequence
    const size = pageSize.value
    loading.value = true
    failed.value = false
    items.value = []
    hasNext.value = false
    try {
      const result = await fetch({ page: targetPage, pageSize: size })
      if (ticket !== sequence) return false
      page.value = result.page
      items.value = result.items
      hasNext.value = result.hasNext
      return true
    } catch {
      if (ticket === sequence) failed.value = true
      return false
    } finally {
      if (ticket === sequence) loading.value = false
    }
  }
  const next = () =>
    hasNext.value && !loading.value && page.value < IAM_MANAGEMENT_PAGINATION.maxPage
      ? load(page.value + 1)
      : Promise.resolve(false)
  const previous = () =>
    page.value > 1 && !loading.value ? load(page.value - 1) : Promise.resolve(false)
  return { page, pageSize, items, hasNext, loading, failed, load, clear, next, previous }
}
