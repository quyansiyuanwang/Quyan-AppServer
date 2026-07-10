<template>
  <div v-if="isDesktop" class="desktop-page">
    <div class="stats-toolbar">
      <div class="page-title">{{ i18ns.t('ConsumptionStats.title') }}</div>
      <div class="toolbar-right">
        <el-date-picker
          v-model="dateRange"
          type="daterange"
          unlink-panels
          :clearable="false"
          :start-placeholder="i18ns.t('ConsumptionStats.startDate')"
          :end-placeholder="i18ns.t('ConsumptionStats.endDate')"
          style="width: 320px"
          @change="loadStats"
        />
        <el-button :icon="Refresh" :loading="loading" @click="loadStats">
          {{ i18ns.t('ConsumptionStats.refresh') }}
        </el-button>
      </div>
    </div>

    <div class="consumption-stats-container">
      <ConsumptionStatsFilters
        :active-filter-tags="activeFilterTags"
        :filter-selections="filterSelections"
        :get-selected-summary="getSelectedSummary"
        :is-desktop="isDesktop"
        :loading="loading"
        :stats="stats"
        @apply="loadStats"
        @reset="resetAllFilters"
        @update:filter-selections="Object.assign(filterSelections, $event)"
      />

      <ConsumptionStatsSummaryGrid
        :is-desktop="isDesktop"
        :loading="loading"
        :summary-cards="summaryCards"
      />

      <ConsumptionStatsCharts
        :channel-pie-option="channelPieOption"
        :daily-trend-option="dailyTrendOption"
        :is-desktop="isDesktop"
        :loading="loading"
        :model-bar-option="modelBarOption"
        :user-bar-option="userBarOption"
      />

      <ConsumptionStatsTables
        :format-currency="formatCurrency"
        :format-percent="formatPercent"
        :is-desktop="isDesktop"
        :loading="loading"
        :range-text="rangeText"
        :stats="stats"
      />
    </div>
  </div>

  <div v-else class="mobile-page consumption-mobile">
    <div class="mobile-toolbar">
      <el-date-picker
        v-model="mobileDateRange"
        type="daterange"
        unlink-panels
        :clearable="false"
        :start-placeholder="i18ns.t('ConsumptionStats.startDate')"
        :end-placeholder="i18ns.t('ConsumptionStats.endDate')"
        style="width: 100%"
        @change="onMobileDateChange"
      />
      <el-button type="primary" :icon="Refresh" :loading="loading" @click="loadStats">
        {{ i18ns.t('ConsumptionStats.refresh') }}
      </el-button>
    </div>

    <ConsumptionStatsFilters
      :active-filter-tags="activeFilterTags"
      :filter-selections="filterSelections"
      :get-selected-summary="getSelectedSummary"
      :is-desktop="isDesktop"
      :loading="loading"
      :stats="stats"
      @apply="loadStats"
      @reset="resetAllFilters"
      @update:filter-selections="Object.assign(filterSelections, $event)"
    />

    <ConsumptionStatsSummaryGrid
      :is-desktop="isDesktop"
      :loading="loading"
      :summary-cards="summaryCards"
    />

    <ConsumptionStatsCharts
      :channel-pie-option="channelPieOption"
      :daily-trend-option="dailyTrendOption"
      :is-desktop="isDesktop"
      :loading="loading"
      :model-bar-option="modelBarOption"
      :user-bar-option="userBarOption"
    />

    <ConsumptionStatsTables
      :format-currency="formatCurrency"
      :format-percent="formatPercent"
      :is-desktop="isDesktop"
      :loading="loading"
      :range-text="rangeText"
      :stats="stats"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { usePageDevice } from '@/composables/usePageDevice'
import { i18ns } from '@/locales'
import systemService from '@/service/systemService'
import ConsumptionStatsCharts from './consumption-stats/components/ConsumptionStatsCharts.vue'
import ConsumptionStatsFilters from './consumption-stats/components/ConsumptionStatsFilters.vue'
import ConsumptionStatsSummaryGrid from './consumption-stats/components/ConsumptionStatsSummaryGrid.vue'
import ConsumptionStatsTables from './consumption-stats/components/ConsumptionStatsTables.vue'
import { createConsumptionChartOptions } from './consumption-stats/chart-options'
import {
  buildDefaultRange,
  createChunkedRanges,
  defaultSelections,
  defaultStats,
  formatCurrency,
  formatDate,
  formatNumber,
  formatPercent,
  mergeChunkedStats,
  normalizeStatsResponse,
} from './consumption-stats/stats-utils'
import type {
  ConsumptionFilterSelections,
  ConsumptionStatsFilterOption,
  ConsumptionStatsFilterOptions,
  ConsumptionStatsResponse,
  ConsumptionStatsResponsePayload,
  FilterSelectionKey,
} from './consumption-stats/types'

const stats = ref<ConsumptionStatsResponse>(defaultStats())
const loading = ref(false)
const userRegex = ref('')

const filterSelections = reactive<ConsumptionFilterSelections>(defaultSelections())

const dateRange = ref<[Date, Date]>(buildDefaultRange())
const mobileDateRange = ref<[Date, Date]>(buildDefaultRange())

const snapshotSelections = (): ConsumptionFilterSelections => ({
  userIds: [...filterSelections.userIds],
  models: [...filterSelections.models],
  channels: [...filterSelections.channels],
  relayTokenIds: [...filterSelections.relayTokenIds],
})

const activeFilterTags = computed(() => {
  const tags: Array<{ key: FilterSelectionKey; label: string }> = []

  if (filterSelections.userIds.length > 0) {
    tags.push({
      key: 'userIds',
      label: `${i18ns.t('ConsumptionStats.user')}: ${filterSelections.userIds.length}`,
    })
  }

  if (filterSelections.models.length > 0) {
    tags.push({
      key: 'models',
      label: `${i18ns.t('ConsumptionStats.model')}: ${filterSelections.models.length}`,
    })
  }

  if (filterSelections.channels.length > 0) {
    tags.push({
      key: 'channels',
      label: `${i18ns.t('ConsumptionStats.channel')}: ${filterSelections.channels.length}`,
    })
  }

  if (filterSelections.relayTokenIds.length > 0) {
    tags.push({
      key: 'relayTokenIds',
      label: `${i18ns.t('ConsumptionStats.relayToken')}: ${filterSelections.relayTokenIds.length}`,
    })
  }

  return tags
})

const clearAllFilterSelections = () => {
  Object.assign(filterSelections, defaultSelections())
}

const selectAllFilter = (key: FilterSelectionKey, options: ConsumptionStatsFilterOption[]) => {
  filterSelections[key] = options.map((option) => option.key)
}

const invertFilterSelection = (
  key: FilterSelectionKey,
  options: ConsumptionStatsFilterOption[],
) => {
  const selected = new Set(filterSelections[key])
  filterSelections[key] = options
    .map((option) => option.key)
    .filter((optionKey) => !selected.has(optionKey))
}

const clearFilterSelection = (key: FilterSelectionKey) => {
  filterSelections[key] = []
}

const getSelectedSummary = (key: FilterSelectionKey, total: number): string => {
  return `${i18ns.t('ConsumptionStats.selectedCount')}: ${filterSelections[key].length}/${total}`
}

const syncFilterSelections = (options: ConsumptionStatsFilterOptions): boolean => {
  const mappings: Array<{ key: FilterSelectionKey; options: ConsumptionStatsFilterOption[] }> = [
    { key: 'userIds', options: options.users },
    { key: 'models', options: options.models },
    { key: 'channels', options: options.channels },
    { key: 'relayTokenIds', options: options.relayTokens },
  ]

  let changed = false

  for (const item of mappings) {
    const allowed = new Set(item.options.map((option) => option.key))
    const next = filterSelections[item.key].filter((value) => allowed.has(value))

    if (next.length !== filterSelections[item.key].length) {
      filterSelections[item.key] = next
      changed = true
    }
  }

  return changed
}

const selectionsEqual = (
  left: ConsumptionFilterSelections,
  right: ConsumptionFilterSelections,
): boolean => {
  const keys: FilterSelectionKey[] = ['userIds', 'models', 'channels', 'relayTokenIds']

  return keys.every((key) => {
    if (left[key].length !== right[key].length) return false
    return left[key].every((value, index) => value === right[key][index])
  })
}

const fetchStats = async (
  range: [Date, Date],
  selections: ConsumptionFilterSelections,
): Promise<ConsumptionStatsResponse> => {
  const chunkRanges = createChunkedRanges(range)
  const chunkResponses: ConsumptionStatsResponse[] = []

  for (const [startDate, endDate] of chunkRanges) {
    const response = normalizeStatsResponse(
      (await systemService.getConsumptionStats(
        {
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
          userIds: selections.userIds,
          models: selections.models,
          channels: selections.channels,
          relayTokenIds: selections.relayTokenIds,
        },
        true,
      )) as ConsumptionStatsResponsePayload,
    )

    chunkResponses.push(response)
  }

  const firstChunk = chunkResponses[0]
  return chunkResponses.length === 1 && firstChunk
    ? firstChunk
    : mergeChunkedStats(chunkResponses, range)
}

const rangeText = computed(() => {
  return `${formatDate(stats.value.range.startDate)} ~ ${formatDate(stats.value.range.endDate)}`
})

const { summaryCards, dailyTrendOption, channelPieOption, modelBarOption, userBarOption } =
  createConsumptionChartOptions(stats, formatCurrency, formatNumber)

const loadStats = async () => {
  loading.value = true
  try {
    const currentRange: [Date, Date] = [new Date(dateRange.value[0]), new Date(dateRange.value[1])]
    const requestedSelections = snapshotSelections()

    let data = await fetchStats(currentRange, requestedSelections)
    stats.value = data
    mobileDateRange.value = [new Date(currentRange[0]), new Date(currentRange[1])]

    const changed = syncFilterSelections(data.filterOptions)
    if (changed) {
      const syncedSelections = snapshotSelections()
      if (!selectionsEqual(requestedSelections, syncedSelections)) {
        data = await fetchStats(currentRange, syncedSelections)
        stats.value = data
        syncFilterSelections(data.filterOptions)
      }
    }
  } catch (error: any) {
    ElMessage.error(error?.message || i18ns.t('ConsumptionStats.loadFailed'))
  } finally {
    loading.value = false
  }
}

const resetAllFilters = async () => {
  clearAllFilterSelections()
  userRegex.value = ''
  await loadStats()
}

const applyUserRegexSelection = () => {
  let matcher: RegExp

  try {
    matcher = new RegExp(userRegex.value, 'i')
  } catch {
    ElMessage.warning('Invalid user regex')
    return
  }

  const matched = stats.value.filterOptions.users
    .filter((option) => matcher.test(option.label) || matcher.test(option.key))
    .map((option) => option.key)

  if (matched.length === 0) {
    ElMessage.warning('No users matched the regex')
    return
  }

  filterSelections.userIds = matched
}

const onMobileDateChange = (value: [Date, Date] | null) => {
  if (!value) return
  dateRange.value = value
  loadStats()
}

onMounted(() => {
  loadStats()
})

defineExpose({
  loadStats,
  resetAllFilters,
  selectAllFilter,
  invertFilterSelection,
  clearFilterSelection,
  applyUserRegexSelection,
  filterSelections,
  stats,
  userRegex,
})

const { isDesktop } = usePageDevice()
</script>

<style scoped>
.stats-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  max-width: 1400px;
  margin: 0 auto 8px;
  gap: 12px;
  flex-wrap: wrap;
}

.page-title {
  font-size: 20px;
  font-weight: 700;
  color: var(--el-text-color-primary);
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.consumption-stats-container {
  max-width: 1400px;
  margin: 0 auto;
  padding: 0 20px 24px;
}

.consumption-mobile {
  padding: 8px 8px 16px;
}

.mobile-toolbar {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
  margin-bottom: 12px;
}

@media (max-width: 768px) {
  .stats-toolbar {
    padding: 8px 10px;
  }

  .consumption-stats-container {
    padding: 0 10px 16px;
  }
}
</style>
