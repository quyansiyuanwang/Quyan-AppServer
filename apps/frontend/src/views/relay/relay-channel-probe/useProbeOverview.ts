import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import {
  relayChannelProbeService,
  type ProbeOverviewQuery,
} from '@/service/relayChannelProbeService'
import { i18ns } from '@/locales'
import { getErrorMessage } from '@/utils/error-utils'
import { showRequestErrorNotice } from '@/utils/requestErrorNotice'
import type {
  RelayChannelProbeOverviewItemDto,
  RelayProbeOverviewSummaryDto,
} from '@/client/types.gen'

export type ProbeOverviewRow = RelayChannelProbeOverviewItemDto & {
  memberCount?: number
  hasCredentials?: boolean
}
export const probeOverviewPolicy = Object.freeze({ searchDelayMs: 300, defaultPageSize: 20 })
/** Empty editor fields are adapters for display only; drawers must fetch the full profile before editing. */
function asRow(row: RelayProbeOverviewSummaryDto): ProbeOverviewRow {
  return {
    ...row,
    profile: row.profile
      ? { ...row.profile, workflow: [], probePayload: {}, credentialNames: [] }
      : undefined,
  }
}
export function useProbeOverview() {
  const items = ref<ProbeOverviewRow[]>([]),
    loading = ref(false),
    pageError = ref('')
  const overviewPage = ref(1),
    overviewPageSize = ref<number>(probeOverviewPolicy.defaultPageSize),
    overviewTotal = ref(0)
  const keyword = ref(''),
    groupFilter = ref('')
  const profileFilter = ref<NonNullable<ProbeOverviewQuery['profile']>>('all')
  const enabledFilter = ref<NonNullable<ProbeOverviewQuery['enabled']>>('enabled')
  const runStatusFilter = ref<NonNullable<ProbeOverviewQuery['runStatus']>>('all')
  const suggestionFilter = ref<NonNullable<ProbeOverviewQuery['suggestion']>>('all')
  const memberPages = reactive<
    Record<
      string,
      { page: number; pageSize: number; total: number; loading: boolean; error: string }
    >
  >({})
  let sequence = 0,
    disposed = false,
    filterTimer: ReturnType<typeof setTimeout> | undefined
  const pending = new Map<string, { sequence: number; promise: Promise<void> }>(),
    memberSequences = new Map<string, number>()
  const query = () => ({
    page: overviewPage.value,
    pageSize: overviewPageSize.value,
    search: keyword.value || undefined,
    group: groupFilter.value || undefined,
    profile: profileFilter.value,
    enabled: enabledFilter.value,
    runStatus: runStatusFilter.value,
    suggestion: suggestionFilter.value,
  })
  function loadOverview(): Promise<void> {
    const input = query(),
      key = JSON.stringify(input)
    const existing = pending.get(key)
    if (existing?.sequence === sequence) return existing.promise
    const current = ++sequence
    loading.value = true
    pageError.value = ''
    const promise = (async () => {
      try {
        const result = await relayChannelProbeService.listOverviewPage(input)
        if (disposed || current !== sequence) return
        items.value = result.items.map(asRow)
        overviewTotal.value = result.total
        if (overviewPage.value > 1 && !result.items.length && result.total)
          overviewPage.value = Math.ceil(result.total / overviewPageSize.value)
      } catch (error) {
        if (!disposed && current === sequence)
          pageError.value = getErrorMessage(error, i18ns.t('operationFailed'))
      } finally {
        if (pending.get(key)?.sequence === current) pending.delete(key)
        if (!disposed && current === sequence) loading.value = false
      }
    })()
    pending.set(key, { sequence: current, promise })
    return promise
  }
  async function refreshOverviewRow(channelId: string) {
    const started = sequence
    const result = await relayChannelProbeService.listOverviewPage({
      ...query(),
      channelId,
      page: 1,
      pageSize: 1,
    })
    if (disposed || sequence !== started) return
    const row = result.items[0]
    if (!row) {
      const previousLength = items.value.length
      items.value = items.value.filter((item) => item.channelId !== channelId)
      overviewTotal.value = Math.max(0, overviewTotal.value - previousLength + items.value.length)
      if (items.value.length < previousLength) await loadOverview()
      return
    }
    items.value = items.value.map((item) =>
      item.channelId === channelId ? { ...asRow(row), members: item.members } : item,
    )
  }
  async function loadMembers(channelId: string, page = 1) {
    const state = (memberPages[channelId] ??= {
      page: 1,
      pageSize: probeOverviewPolicy.defaultPageSize,
      total: 0,
      loading: false,
      error: '',
    })
    if (state.loading && state.page === page) return
    state.page = page
    state.loading = true
    state.error = ''
    const current = (memberSequences.get(channelId) ?? 0) + 1
    memberSequences.set(channelId, current)
    try {
      const result = await relayChannelProbeService.listMemberPage(channelId, page, state.pageSize)
      if (disposed || memberSequences.get(channelId) !== current) return
      state.total = result.total
      items.value = items.value.map((row) =>
        row.channelId === channelId ? { ...row, members: result.items } : row,
      )
    } catch (error) {
      if (!disposed && memberSequences.get(channelId) === current) {
        state.error = getErrorMessage(error, i18ns.t('operationFailed'))
        showRequestErrorNotice(error, i18ns.t('operationFailed'))
      }
    } finally {
      if (memberSequences.get(channelId) === current) state.loading = false
    }
  }
  function onExpandChange(row: ProbeOverviewRow, expanded: ProbeOverviewRow[]) {
    if (row.channelType === 'pooled' && expanded.some((item) => item.channelId === row.channelId))
      void loadMembers(row.channelId, memberPages[row.channelId]?.page ?? 1)
  }
  watch(
    [keyword, groupFilter, profileFilter, enabledFilter, runStatusFilter, suggestionFilter],
    () => {
      ++sequence
      clearTimeout(filterTimer)
      filterTimer = setTimeout(() => {
        if (overviewPage.value !== 1) overviewPage.value = 1
        else void loadOverview()
      }, probeOverviewPolicy.searchDelayMs)
    },
  )
  watch([overviewPage, overviewPageSize], ([page, size], [, oldSize]) => {
    if (size !== oldSize && page !== 1) {
      overviewPage.value = 1
      return
    }
    void loadOverview()
  })
  onBeforeUnmount(() => {
    disposed = true
    ++sequence
    clearTimeout(filterTimer)
  })
  return {
    items,
    loading,
    pageError,
    overviewPage,
    overviewPageSize,
    overviewTotal,
    keyword,
    groupFilter,
    profileFilter,
    enabledFilter,
    runStatusFilter,
    suggestionFilter,
    memberPages,
    loadOverview,
    refreshOverviewRow,
    loadMembers,
    onExpandChange,
    filteredItems: computed(() => items.value),
  }
}
