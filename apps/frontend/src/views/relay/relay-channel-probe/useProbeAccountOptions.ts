import { onBeforeUnmount, ref, type ComputedRef } from 'vue'
import type { RelayChannelProbeAccountDto } from '@/client/types.gen'
import { relayChannelProbeService } from '@/service/relayChannelProbeService'
import { showRequestErrorNotice } from '@/utils/requestErrorNotice'
import { i18ns } from '@/locales'
const policy = Object.freeze({ pageSize: 20, searchDelayMs: 300 })

export function useProbeAccountOptions(allowed: ComputedRef<boolean>) {
  const accounts = ref<RelayChannelProbeAccountDto[]>([]),
    accountsLoading = ref(false),
    accountsHasMore = ref(false)
  let search = '',
    page = 0,
    sequence = 0,
    disposed = false,
    timer: ReturnType<typeof setTimeout> | undefined
  let active: { key: string; promise: Promise<void> } | undefined
  function fetchAccountPage(nextPage: number, term: string): Promise<void> {
    if (!allowed.value || disposed) return Promise.resolve()
    const key = JSON.stringify([nextPage, term])
    if (active?.key === key) return active.promise
    const current = ++sequence
    accountsLoading.value = true
    const promise = (async () => {
      try {
        const result = await relayChannelProbeService.listAccountPage(
          nextPage,
          policy.pageSize,
          term || undefined,
        )
        if (disposed || current !== sequence) return
        accounts.value = nextPage === 1 ? result.items : [...accounts.value, ...result.items]
        page = nextPage
        search = term
        accountsHasMore.value = accounts.value.length < result.total
      } catch (error) {
        if (!disposed && current === sequence)
          showRequestErrorNotice(error, i18ns.t('operationFailed'))
      } finally {
        if (current === sequence) {
          accountsLoading.value = false
          active = undefined
        }
      }
    })()
    active = { key, promise }
    return promise
  }
  function loadAccounts(term?: string) {
    return fetchAccountPage(1, typeof term === 'string' ? term : '')
  }
  function searchAccounts(term: string) {
    ++sequence
    active = undefined
    clearTimeout(timer)
    timer = setTimeout(() => {
      void fetchAccountPage(1, term)
    }, policy.searchDelayMs)
  }
  function loadMoreAccounts() {
    if (!accountsLoading.value && accountsHasMore.value) return fetchAccountPage(page + 1, search)
  }
  onBeforeUnmount(() => {
    disposed = true
    ++sequence
    clearTimeout(timer)
  })
  return {
    accounts,
    accountsLoading,
    accountsHasMore,
    loadAccounts,
    searchAccounts,
    loadMoreAccounts,
  }
}
