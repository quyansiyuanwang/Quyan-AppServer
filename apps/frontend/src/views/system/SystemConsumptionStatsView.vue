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
      <el-card class="filter-card" shadow="never">
        <template #header>
          <div class="card-header table-toolbar">
            <span class="card-title">{{ i18ns.t('ConsumptionStats.filtersTitle') }}</span>
            <div class="filter-header-actions">
              <el-button size="small" type="primary" :loading="loading" @click="loadStats">
                {{ i18ns.t('ConsumptionStats.applyFilters') }}
              </el-button>
              <el-button size="small" @click="resetAllFilters">
                {{ i18ns.t('ConsumptionStats.clearAllFilters') }}
              </el-button>
            </div>
          </div>
        </template>

        <div class="filter-grid">
          <div class="filter-item">
            <div class="filter-label-row">
              <span class="filter-label">{{ i18ns.t('ConsumptionStats.userFilter') }}</span>
              <span class="filter-count">{{
                getSelectedSummary('userIds', stats.filterOptions.users.length)
              }}</span>
            </div>
            <FilterTableSelect
              v-model="filterSelections.userIds"
              :options="stats.filterOptions.users"
              :placeholder="i18ns.t('ConsumptionStats.userFilterPlaceholder')"
              :searchPlaceholder="i18ns.t('ConsumptionStats.userRegexPlaceholder')"
              :column-label="i18ns.t('ConsumptionStats.user')"
              :popover-width="320"
            />
          </div>

          <div class="filter-item">
            <div class="filter-label-row">
              <span class="filter-label">{{ i18ns.t('ConsumptionStats.modelFilter') }}</span>
              <span class="filter-count">{{
                getSelectedSummary('models', stats.filterOptions.models.length)
              }}</span>
            </div>
            <FilterTableSelect
              v-model="filterSelections.models"
              :options="stats.filterOptions.models"
              :placeholder="i18ns.t('ConsumptionStats.modelFilterPlaceholder')"
              :searchPlaceholder="i18ns.t('ConsumptionStats.modelFilterPlaceholder')"
              :column-label="i18ns.t('ConsumptionStats.model')"
              :popover-width="320"
            />
          </div>

          <div class="filter-item">
            <div class="filter-label-row">
              <span class="filter-label">{{ i18ns.t('ConsumptionStats.channelFilter') }}</span>
              <span class="filter-count">{{
                getSelectedSummary('channels', stats.filterOptions.channels.length)
              }}</span>
            </div>
            <FilterTableSelect
              v-model="filterSelections.channels"
              :options="stats.filterOptions.channels"
              :placeholder="i18ns.t('ConsumptionStats.channelFilterPlaceholder')"
              :searchPlaceholder="i18ns.t('ConsumptionStats.channelFilterPlaceholder')"
              :column-label="i18ns.t('ConsumptionStats.channel')"
              :popover-width="320"
            />
          </div>

          <div class="filter-item">
            <div class="filter-label-row">
              <span class="filter-label">{{ i18ns.t('ConsumptionStats.relayTokenFilter') }}</span>
              <span class="filter-count">{{
                getSelectedSummary('relayTokenIds', stats.filterOptions.relayTokens.length)
              }}</span>
            </div>
            <FilterTableSelect
              v-model="filterSelections.relayTokenIds"
              :options="stats.filterOptions.relayTokens"
              :placeholder="i18ns.t('ConsumptionStats.relayTokenFilterPlaceholder')"
              :searchPlaceholder="i18ns.t('ConsumptionStats.relayTokenFilterPlaceholder')"
              :column-label="i18ns.t('ConsumptionStats.relayToken')"
              :popover-width="320"
            />
          </div>
        </div>

        <div class="filter-footer">
          <div class="filter-tag-list" v-if="activeFilterTags.length > 0">
            <el-tag v-for="item in activeFilterTags" :key="item.key" size="small" type="info">
              {{ item.label }}
            </el-tag>
          </div>
          <div v-else class="filter-hint">{{ i18ns.t('ConsumptionStats.noActiveFilters') }}</div>
        </div>
      </el-card>

      <el-row :gutter="16" class="summary-grid">
        <el-col v-for="item in summaryCards" :key="item.key" :xs="24" :sm="12" :md="8" :lg="4">
          <el-card class="summary-card" shadow="hover" v-loading="loading">
            <div class="summary-label">{{ item.label }}</div>
            <div class="summary-value">{{ item.value }}</div>
            <div class="summary-hint">{{ item.hint }}</div>
          </el-card>
        </el-col>
      </el-row>

      <el-row :gutter="16" class="chart-grid">
        <el-col :xs="24" :lg="16">
          <el-card class="chart-card" shadow="never" v-loading="loading">
            <template #header>
              <div class="card-header">
                <span class="card-title">{{ i18ns.t('ConsumptionStats.dailyTrend') }}</span>
              </div>
            </template>
            <AsyncVChart class="chart" autoresize :option="dailyTrendOption" />
          </el-card>
        </el-col>
        <el-col :xs="24" :lg="8">
          <el-card class="chart-card" shadow="never" v-loading="loading">
            <template #header>
              <div class="card-header">
                <span class="card-title">{{
                  i18ns.t('ConsumptionStats.channelDistribution')
                }}</span>
              </div>
            </template>
            <AsyncVChart class="chart" autoresize :option="channelPieOption" />
          </el-card>
        </el-col>
      </el-row>

      <el-row :gutter="16" class="chart-grid">
        <el-col :xs="24" :lg="12">
          <el-card class="chart-card" shadow="never" v-loading="loading">
            <template #header>
              <div class="card-header">
                <span class="card-title">{{ i18ns.t('ConsumptionStats.modelDistribution') }}</span>
              </div>
            </template>
            <AsyncVChart class="chart" autoresize :option="modelBarOption" />
          </el-card>
        </el-col>
        <el-col :xs="24" :lg="12">
          <el-card class="chart-card" shadow="never" v-loading="loading">
            <template #header>
              <div class="card-header">
                <span class="card-title">{{ i18ns.t('ConsumptionStats.userDistribution') }}</span>
              </div>
            </template>
            <AsyncVChart class="chart" autoresize :option="userBarOption" />
          </el-card>
        </el-col>
      </el-row>

      <el-card class="table-card" shadow="never" v-loading="loading">
        <template #header>
          <div class="card-header table-toolbar">
            <span class="card-title">{{ i18ns.t('ConsumptionStats.channelTable') }}</span>
            <el-tag type="info">{{ rangeText }}</el-tag>
          </div>
        </template>
        <el-table :data="stats.byChannel" size="small">
          <el-table-column
            prop="label"
            :label="i18ns.t('ConsumptionStats.channel')"
            min-width="180"
          />
          <el-table-column
            prop="totalSpend"
            :label="i18ns.t('ConsumptionStats.totalSpend')"
            min-width="140"
          >
            <template #default="{ row }">{{ formatCurrency(row.totalSpend) }}</template>
          </el-table-column>
          <el-table-column
            prop="chargedSpend"
            :label="i18ns.t('ConsumptionStats.chargedSpend')"
            min-width="140"
          >
            <template #default="{ row }">{{ formatCurrency(row.chargedSpend) }}</template>
          </el-table-column>
          <el-table-column
            prop="coveredSpend"
            :label="i18ns.t('ConsumptionStats.coveredSpend')"
            min-width="140"
          >
            <template #default="{ row }">{{ formatCurrency(row.coveredSpend) }}</template>
          </el-table-column>
          <el-table-column
            prop="totalRequests"
            :label="i18ns.t('ConsumptionStats.requests')"
            min-width="110"
          />
          <el-table-column
            prop="totalTokens"
            :label="i18ns.t('ConsumptionStats.tokens')"
            min-width="130"
          />
          <el-table-column prop="share" :label="i18ns.t('ConsumptionStats.share')" min-width="110">
            <template #default="{ row }">{{ formatPercent(row.share) }}</template>
          </el-table-column>
        </el-table>
      </el-card>

      <el-row :gutter="16" class="table-grid">
        <el-col :xs="24" :xl="12">
          <el-card class="table-card" shadow="never" v-loading="loading">
            <template #header>
              <div class="card-header">
                <span class="card-title">{{ i18ns.t('ConsumptionStats.modelTable') }}</span>
              </div>
            </template>
            <el-table :data="stats.byModel" size="small">
              <el-table-column
                prop="label"
                :label="i18ns.t('ConsumptionStats.model')"
                min-width="200"
              />
              <el-table-column
                prop="totalSpend"
                :label="i18ns.t('ConsumptionStats.totalSpend')"
                min-width="130"
              >
                <template #default="{ row }">{{ formatCurrency(row.totalSpend) }}</template>
              </el-table-column>
              <el-table-column
                prop="totalRequests"
                :label="i18ns.t('ConsumptionStats.requests')"
                min-width="100"
              />
              <el-table-column
                prop="totalTokens"
                :label="i18ns.t('ConsumptionStats.tokens')"
                min-width="120"
              />
            </el-table>
          </el-card>
        </el-col>
        <el-col :xs="24" :xl="12">
          <el-card class="table-card" shadow="never" v-loading="loading">
            <template #header>
              <div class="card-header">
                <span class="card-title">{{ i18ns.t('ConsumptionStats.userTable') }}</span>
              </div>
            </template>
            <el-table :data="stats.byUser" size="small">
              <el-table-column
                prop="label"
                :label="i18ns.t('ConsumptionStats.user')"
                min-width="180"
              />
              <el-table-column
                prop="totalSpend"
                :label="i18ns.t('ConsumptionStats.totalSpend')"
                min-width="130"
              >
                <template #default="{ row }">{{ formatCurrency(row.totalSpend) }}</template>
              </el-table-column>
              <el-table-column
                prop="totalRequests"
                :label="i18ns.t('ConsumptionStats.requests')"
                min-width="100"
              />
              <el-table-column
                prop="totalTokens"
                :label="i18ns.t('ConsumptionStats.tokens')"
                min-width="120"
              />
            </el-table>
          </el-card>
        </el-col>
      </el-row>
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

    <el-card class="filter-card mobile-filter-card" shadow="never">
      <template #header>
        <div class="card-header table-toolbar">
          <span class="card-title">{{ i18ns.t('ConsumptionStats.filtersTitle') }}</span>
        </div>
      </template>

      <div class="filter-grid mobile-filter-grid">
        <div class="filter-item">
          <div class="filter-label-row">
            <span class="filter-label">{{ i18ns.t('ConsumptionStats.userFilter') }}</span>
            <span class="filter-count">{{
              getSelectedSummary('userIds', stats.filterOptions.users.length)
            }}</span>
          </div>
          <FilterTableSelect
            v-model="filterSelections.userIds"
            :options="stats.filterOptions.users"
            :placeholder="i18ns.t('ConsumptionStats.userFilterPlaceholder')"
            :searchPlaceholder="i18ns.t('ConsumptionStats.userRegexPlaceholder')"
            :column-label="i18ns.t('ConsumptionStats.user')"
            :popover-width="280"
          />
        </div>

        <div class="filter-item">
          <div class="filter-label-row">
            <span class="filter-label">{{ i18ns.t('ConsumptionStats.modelFilter') }}</span>
            <span class="filter-count">{{
              getSelectedSummary('models', stats.filterOptions.models.length)
            }}</span>
          </div>
          <FilterTableSelect
            v-model="filterSelections.models"
            :options="stats.filterOptions.models"
            :placeholder="i18ns.t('ConsumptionStats.modelFilterPlaceholder')"
            :searchPlaceholder="i18ns.t('ConsumptionStats.modelFilterPlaceholder')"
            :column-label="i18ns.t('ConsumptionStats.model')"
            :popover-width="280"
          />
        </div>

        <div class="filter-item">
          <div class="filter-label-row">
            <span class="filter-label">{{ i18ns.t('ConsumptionStats.channelFilter') }}</span>
            <span class="filter-count">{{
              getSelectedSummary('channels', stats.filterOptions.channels.length)
            }}</span>
          </div>
          <FilterTableSelect
            v-model="filterSelections.channels"
            :options="stats.filterOptions.channels"
            :placeholder="i18ns.t('ConsumptionStats.channelFilterPlaceholder')"
            :searchPlaceholder="i18ns.t('ConsumptionStats.channelFilterPlaceholder')"
            :column-label="i18ns.t('ConsumptionStats.channel')"
            :popover-width="280"
          />
        </div>

        <div class="filter-item">
          <div class="filter-label-row">
            <span class="filter-label">{{ i18ns.t('ConsumptionStats.relayTokenFilter') }}</span>
            <span class="filter-count">{{
              getSelectedSummary('relayTokenIds', stats.filterOptions.relayTokens.length)
            }}</span>
          </div>
          <FilterTableSelect
            v-model="filterSelections.relayTokenIds"
            :options="stats.filterOptions.relayTokens"
            :placeholder="i18ns.t('ConsumptionStats.relayTokenFilterPlaceholder')"
            :searchPlaceholder="i18ns.t('ConsumptionStats.relayTokenFilterPlaceholder')"
            :column-label="i18ns.t('ConsumptionStats.relayToken')"
            :popover-width="280"
          />
        </div>
      </div>

      <div class="mobile-filter-actions">
        <el-button type="primary" :loading="loading" @click="loadStats">
          {{ i18ns.t('ConsumptionStats.applyFilters') }}
        </el-button>
        <el-button @click="resetAllFilters">{{
          i18ns.t('ConsumptionStats.clearAllFilters')
        }}</el-button>
      </div>
    </el-card>

    <div class="mobile-summary-grid">
      <el-card
        v-for="item in summaryCards"
        :key="item.key"
        class="summary-card"
        shadow="hover"
        v-loading="loading"
      >
        <div class="summary-label">{{ item.label }}</div>
        <div class="summary-value">{{ item.value }}</div>
        <div class="summary-hint">{{ item.hint }}</div>
      </el-card>
    </div>

    <el-card class="chart-card" shadow="never" v-loading="loading">
      <template #header>
        <div class="card-header">
          <span class="card-title">{{ i18ns.t('ConsumptionStats.dailyTrend') }}</span>
        </div>
      </template>
      <AsyncVChart class="chart mobile-chart" autoresize :option="dailyTrendOption" />
    </el-card>

    <el-collapse class="mobile-collapse">
      <el-collapse-item :title="i18ns.t('ConsumptionStats.channelTable')" name="channel">
        <el-table :data="stats.byChannel" size="small">
          <el-table-column
            prop="label"
            :label="i18ns.t('ConsumptionStats.channel')"
            min-width="140"
          />
          <el-table-column
            prop="totalSpend"
            :label="i18ns.t('ConsumptionStats.totalSpend')"
            min-width="120"
          >
            <template #default="{ row }">{{ formatCurrency(row.totalSpend) }}</template>
          </el-table-column>
        </el-table>
      </el-collapse-item>
      <el-collapse-item :title="i18ns.t('ConsumptionStats.modelTable')" name="model">
        <el-table :data="stats.byModel" size="small">
          <el-table-column
            prop="label"
            :label="i18ns.t('ConsumptionStats.model')"
            min-width="160"
          />
          <el-table-column
            prop="totalSpend"
            :label="i18ns.t('ConsumptionStats.totalSpend')"
            min-width="120"
          >
            <template #default="{ row }">{{ formatCurrency(row.totalSpend) }}</template>
          </el-table-column>
        </el-table>
      </el-collapse-item>
      <el-collapse-item :title="i18ns.t('ConsumptionStats.userTable')" name="user">
        <el-table :data="stats.byUser" size="small">
          <el-table-column prop="label" :label="i18ns.t('ConsumptionStats.user')" min-width="140" />
          <el-table-column
            prop="totalSpend"
            :label="i18ns.t('ConsumptionStats.totalSpend')"
            min-width="120"
          >
            <template #default="{ row }">{{ formatCurrency(row.totalSpend) }}</template>
          </el-table-column>
        </el-table>
      </el-collapse-item>
    </el-collapse>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { usePageDevice } from '@/composables/usePageDevice'
import { i18ns } from '@/locales'
import systemService from '@/service/systemService'
import { AsyncVChart } from '@/utils/asyncChart'
import FilterTableSelect from '@/components/common/FilterTableSelect.vue'

interface ConsumptionStatsFilterOption {
  key: string
  label: string
}

interface ConsumptionStatsFilterOptions {
  users: ConsumptionStatsFilterOption[]
  models: ConsumptionStatsFilterOption[]
  channels: ConsumptionStatsFilterOption[]
  relayTokens: ConsumptionStatsFilterOption[]
}

interface ConsumptionStatsSummary {
  totalSpend: number
  chargedSpend: number
  coveredSpend: number
  totalRequests: number
  zeroChargeRequests: number
  totalTokens: number
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  activeUsers: number
  consumingUsers: number
  avgSpendPerRequest: number
  avgTokensPerRequest: number
}

interface ConsumptionStatsBreakdown extends ConsumptionStatsSummary {
  key: string
  label: string
  share: number
}

interface ConsumptionStatsDaily extends ConsumptionStatsSummary {
  date: string
}

interface ConsumptionStatsResponse {
  range: {
    startDate: string
    endDate: string
    days: number
  }
  filterOptions: ConsumptionStatsFilterOptions
  summary: ConsumptionStatsSummary
  daily: ConsumptionStatsDaily[]
  byUser: ConsumptionStatsBreakdown[]
  byChannel: ConsumptionStatsBreakdown[]
  byModel: ConsumptionStatsBreakdown[]
  userDailyDistribution: Array<ConsumptionStatsDaily & { key: string; label: string }>
  channelDailyDistribution: Array<ConsumptionStatsDaily & { key: string; label: string }>
  modelDailyDistribution: Array<ConsumptionStatsDaily & { key: string; label: string }>
  generatedAt: string
}

type ConsumptionStatsResponsePayload = Partial<Omit<ConsumptionStatsResponse, 'filterOptions'>> & {
  filterOptions?: Partial<ConsumptionStatsFilterOptions> | null
}

interface ConsumptionFilterSelections {
  userIds: string[]
  models: string[]
  channels: string[]
  relayTokenIds: string[]
}

type FilterSelectionKey = keyof ConsumptionFilterSelections

const CONSUMPTION_STATS_MAX_CHUNK_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000

const emptySummary = (): ConsumptionStatsSummary => ({
  totalSpend: 0,
  chargedSpend: 0,
  coveredSpend: 0,
  totalRequests: 0,
  zeroChargeRequests: 0,
  totalTokens: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  activeUsers: 0,
  consumingUsers: 0,
  avgSpendPerRequest: 0,
  avgTokensPerRequest: 0,
})

const emptyFilterOptions = (): ConsumptionStatsFilterOptions => ({
  users: [],
  models: [],
  channels: [],
  relayTokens: [],
})

const normalizeFilterOptions = (
  filterOptions?: Partial<ConsumptionStatsFilterOptions> | null,
): ConsumptionStatsFilterOptions => ({
  users: Array.isArray(filterOptions?.users) ? filterOptions.users : [],
  models: Array.isArray(filterOptions?.models) ? filterOptions.models : [],
  channels: Array.isArray(filterOptions?.channels) ? filterOptions.channels : [],
  relayTokens: Array.isArray(filterOptions?.relayTokens) ? filterOptions.relayTokens : [],
})

const defaultStats = (): ConsumptionStatsResponse => ({
  range: {
    startDate: new Date().toISOString(),
    endDate: new Date().toISOString(),
    days: 1,
  },
  filterOptions: emptyFilterOptions(),
  summary: emptySummary(),
  daily: [],
  byUser: [],
  byChannel: [],
  byModel: [],
  userDailyDistribution: [],
  channelDailyDistribution: [],
  modelDailyDistribution: [],
  generatedAt: new Date().toISOString(),
})

const normalizeStatsResponse = (
  data?: ConsumptionStatsResponsePayload | null,
): ConsumptionStatsResponse => {
  const fallback = defaultStats()

  return {
    ...fallback,
    ...data,
    range: {
      ...fallback.range,
      ...(data?.range ?? {}),
    },
    filterOptions: normalizeFilterOptions(data?.filterOptions),
    summary: {
      ...fallback.summary,
      ...(data?.summary ?? {}),
    },
    daily: Array.isArray(data?.daily) ? data.daily : [],
    byUser: Array.isArray(data?.byUser) ? data.byUser : [],
    byChannel: Array.isArray(data?.byChannel) ? data.byChannel : [],
    byModel: Array.isArray(data?.byModel) ? data.byModel : [],
    userDailyDistribution: Array.isArray(data?.userDailyDistribution)
      ? data.userDailyDistribution
      : [],
    channelDailyDistribution: Array.isArray(data?.channelDailyDistribution)
      ? data.channelDailyDistribution
      : [],
    modelDailyDistribution: Array.isArray(data?.modelDailyDistribution)
      ? data.modelDailyDistribution
      : [],
    generatedAt: data?.generatedAt ?? fallback.generatedAt,
  }
}

const stats = ref<ConsumptionStatsResponse>(defaultStats())
const loading = ref(false)

const filterSelections = reactive<ConsumptionFilterSelections>({
  userIds: [],
  models: [],
  channels: [],
  relayTokenIds: [],
})

const buildDefaultRange = (): [Date, Date] => {
  const end = new Date()
  end.setHours(23, 59, 59, 999)
  const start = new Date(end)
  start.setDate(start.getDate() - 6)
  start.setHours(0, 0, 0, 0)
  return [start, end]
}

const dateRange = ref<[Date, Date]>(buildDefaultRange())
const mobileDateRange = ref<[Date, Date]>(buildDefaultRange())

const formatCurrency = (value: number): string => `${value.toFixed(4)} ${i18ns.t('balance.yuan')}`
const formatNumber = (value: number): string => new Intl.NumberFormat().format(value)
const formatPercent = (value: number): string => `${value.toFixed(2)}%`
const formatDate = (value: string): string => new Date(value).toLocaleDateString()

const round4 = (value: number): number => Math.round(value * 10000) / 10000
const round2 = (value: number): number => Math.round(value * 100) / 100

const startOfDay = (date: Date): Date => {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  return next
}

const endOfDay = (date: Date): Date => {
  const next = new Date(date)
  next.setHours(23, 59, 59, 999)
  return next
}

const createChunkedRanges = (range: [Date, Date]): Array<[Date, Date]> => {
  const resolvedStart = startOfDay(range[0])
  const resolvedEnd = endOfDay(range[1])
  const ranges: Array<[Date, Date]> = []

  let currentStart = new Date(resolvedStart)

  while (currentStart.getTime() <= resolvedEnd.getTime()) {
    const chunkEnd = new Date(
      Math.min(
        endOfDay(
          new Date(currentStart.getTime() + (CONSUMPTION_STATS_MAX_CHUNK_DAYS - 1) * DAY_MS),
        ).getTime(),
        resolvedEnd.getTime(),
      ),
    )

    ranges.push([new Date(currentStart), chunkEnd])
    currentStart = startOfDay(new Date(chunkEnd.getTime() + DAY_MS))
  }

  return ranges
}

const mergeFilterOptions = (
  target: ConsumptionStatsFilterOption[],
  source: ConsumptionStatsFilterOption[],
): ConsumptionStatsFilterOption[] => {
  const map = new Map(target.map((item) => [item.key, item]))

  for (const item of source) {
    if (!map.has(item.key)) {
      map.set(item.key, item)
    }
  }

  return [...map.values()].sort((left, right) => {
    const labelDiff = left.label.localeCompare(right.label)
    return labelDiff !== 0 ? labelDiff : left.key.localeCompare(right.key)
  })
}

const mergeSummary = (
  target: ConsumptionStatsSummary,
  source: ConsumptionStatsSummary,
): ConsumptionStatsSummary => ({
  ...target,
  totalSpend: round4(target.totalSpend + source.totalSpend),
  chargedSpend: round4(target.chargedSpend + source.chargedSpend),
  coveredSpend: round4(target.coveredSpend + source.coveredSpend),
  totalRequests: target.totalRequests + source.totalRequests,
  zeroChargeRequests: target.zeroChargeRequests + source.zeroChargeRequests,
  totalTokens: target.totalTokens + source.totalTokens,
  inputTokens: target.inputTokens + source.inputTokens,
  outputTokens: target.outputTokens + source.outputTokens,
  cacheCreationTokens: target.cacheCreationTokens + source.cacheCreationTokens,
  cacheReadTokens: target.cacheReadTokens + source.cacheReadTokens,
  activeUsers: target.activeUsers + source.activeUsers,
  consumingUsers: target.consumingUsers + source.consumingUsers,
  avgSpendPerRequest: 0,
  avgTokensPerRequest: 0,
})

const finalizeSummary = (
  summary: ConsumptionStatsSummary,
  overrides?: Partial<Pick<ConsumptionStatsSummary, 'activeUsers' | 'consumingUsers'>>,
): ConsumptionStatsSummary => {
  const totalRequests = summary.totalRequests
  return {
    ...summary,
    activeUsers: overrides?.activeUsers ?? summary.activeUsers,
    consumingUsers: overrides?.consumingUsers ?? summary.consumingUsers,
    avgSpendPerRequest: totalRequests > 0 ? round4(summary.totalSpend / totalRequests) : 0,
    avgTokensPerRequest: totalRequests > 0 ? round2(summary.totalTokens / totalRequests) : 0,
  }
}

const mergeBreakdownList = (
  target: ConsumptionStatsBreakdown[],
  source: ConsumptionStatsBreakdown[],
): ConsumptionStatsBreakdown[] => {
  const map = new Map(target.map((item) => [item.key, { ...item }]))

  for (const item of source) {
    const existing = map.get(item.key)
    if (!existing) {
      map.set(item.key, { ...item, share: 0, avgSpendPerRequest: 0, avgTokensPerRequest: 0 })
      continue
    }

    map.set(item.key, {
      ...existing,
      label: existing.label || item.label,
      ...mergeSummary(existing, item),
      share: 0,
    })
  }

  return [...map.values()]
}

const mergeDailyList = (
  target: ConsumptionStatsDaily[],
  source: ConsumptionStatsDaily[],
): ConsumptionStatsDaily[] => {
  const map = new Map(target.map((item) => [item.date, { ...item }]))

  for (const item of source) {
    const existing = map.get(item.date)
    if (!existing) {
      map.set(item.date, { ...item, avgSpendPerRequest: 0, avgTokensPerRequest: 0 })
      continue
    }

    map.set(item.date, {
      date: item.date,
      ...mergeSummary(existing, item),
    })
  }

  return [...map.values()]
}

const mergeDailyBreakdownList = (
  target: Array<ConsumptionStatsDaily & { key: string; label: string }>,
  source: Array<ConsumptionStatsDaily & { key: string; label: string }>,
): Array<ConsumptionStatsDaily & { key: string; label: string }> => {
  const map = new Map(target.map((item) => [`${item.date}::${item.key}`, { ...item }]))

  for (const item of source) {
    const compositeKey = `${item.date}::${item.key}`
    const existing = map.get(compositeKey)
    if (!existing) {
      map.set(compositeKey, { ...item, avgSpendPerRequest: 0, avgTokensPerRequest: 0 })
      continue
    }

    map.set(compositeKey, {
      date: item.date,
      key: item.key,
      label: existing.label || item.label,
      ...mergeSummary(existing, item),
    })
  }

  return [...map.values()]
}

const sortBreakdownList = <T extends { totalSpend: number; totalRequests: number; label: string }>(
  items: T[],
): T[] => {
  return items.sort((left, right) => {
    if (right.totalSpend !== left.totalSpend) return right.totalSpend - left.totalSpend
    if (right.totalRequests !== left.totalRequests) return right.totalRequests - left.totalRequests
    return left.label.localeCompare(right.label)
  })
}

const sortDailyList = (items: ConsumptionStatsDaily[]): ConsumptionStatsDaily[] => {
  return items.sort((left, right) => left.date.localeCompare(right.date))
}

const sortDailyBreakdownList = (
  items: Array<ConsumptionStatsDaily & { key: string; label: string }>,
): Array<ConsumptionStatsDaily & { key: string; label: string }> => {
  return items.sort((left, right) => {
    if (left.date !== right.date) return left.date.localeCompare(right.date)
    if (right.totalSpend !== left.totalSpend) return right.totalSpend - left.totalSpend
    return left.label.localeCompare(right.label)
  })
}

const finalizeBreakdownList = (
  items: ConsumptionStatsBreakdown[],
  totalSpend: number,
): ConsumptionStatsBreakdown[] => {
  return sortBreakdownList(
    items.map((item) => {
      const finalized = finalizeSummary(item)
      const consumingUsers = finalized.totalSpend > 0 ? 1 : 0
      return {
        key: item.key,
        label: item.label,
        ...finalized,
        activeUsers: finalized.totalRequests > 0 ? 1 : 0,
        consumingUsers,
        share: totalSpend > 0 ? round2((finalized.totalSpend / totalSpend) * 100) : 0,
      }
    }),
  )
}

const finalizeDailyStats = (
  daily: ConsumptionStatsDaily[],
  userDailyDistribution: Array<ConsumptionStatsDaily & { key: string; label: string }>,
): ConsumptionStatsDaily[] => {
  const activeUsersByDate = new Map<string, Set<string>>()
  const consumingUsersByDate = new Map<string, Set<string>>()

  for (const item of userDailyDistribution) {
    const activeUsers = activeUsersByDate.get(item.date) ?? new Set<string>()
    activeUsers.add(item.key)
    activeUsersByDate.set(item.date, activeUsers)

    if (item.totalSpend > 0) {
      const consumingUsers = consumingUsersByDate.get(item.date) ?? new Set<string>()
      consumingUsers.add(item.key)
      consumingUsersByDate.set(item.date, consumingUsers)
    }
  }

  return sortDailyList(
    daily.map((item) => ({
      date: item.date,
      ...finalizeSummary(item, {
        activeUsers: activeUsersByDate.get(item.date)?.size ?? item.activeUsers,
        consumingUsers: consumingUsersByDate.get(item.date)?.size ?? item.consumingUsers,
      }),
    })),
  )
}

const mergeChunkedStats = (
  chunks: ConsumptionStatsResponse[],
  requestedRange: [Date, Date],
): ConsumptionStatsResponse => {
  const merged = defaultStats()

  for (const chunk of chunks) {
    merged.filterOptions.users = mergeFilterOptions(
      merged.filterOptions.users,
      chunk.filterOptions.users,
    )
    merged.filterOptions.models = mergeFilterOptions(
      merged.filterOptions.models,
      chunk.filterOptions.models,
    )
    merged.filterOptions.channels = mergeFilterOptions(
      merged.filterOptions.channels,
      chunk.filterOptions.channels,
    )
    merged.filterOptions.relayTokens = mergeFilterOptions(
      merged.filterOptions.relayTokens,
      chunk.filterOptions.relayTokens,
    )
    merged.summary = mergeSummary(merged.summary, chunk.summary)
    merged.daily = mergeDailyList(merged.daily, chunk.daily)
    merged.byUser = mergeBreakdownList(merged.byUser, chunk.byUser)
    merged.byChannel = mergeBreakdownList(merged.byChannel, chunk.byChannel)
    merged.byModel = mergeBreakdownList(merged.byModel, chunk.byModel)
    merged.userDailyDistribution = mergeDailyBreakdownList(
      merged.userDailyDistribution,
      chunk.userDailyDistribution,
    )
    merged.channelDailyDistribution = mergeDailyBreakdownList(
      merged.channelDailyDistribution,
      chunk.channelDailyDistribution,
    )
    merged.modelDailyDistribution = mergeDailyBreakdownList(
      merged.modelDailyDistribution,
      chunk.modelDailyDistribution,
    )
    merged.generatedAt =
      chunk.generatedAt > merged.generatedAt ? chunk.generatedAt : merged.generatedAt
  }

  merged.byUser = finalizeBreakdownList(merged.byUser, merged.summary.totalSpend)
  merged.byChannel = finalizeBreakdownList(merged.byChannel, merged.summary.totalSpend)
  merged.byModel = finalizeBreakdownList(merged.byModel, merged.summary.totalSpend)
  merged.userDailyDistribution = sortDailyBreakdownList(
    merged.userDailyDistribution.map((item) => ({
      date: item.date,
      key: item.key,
      label: item.label,
      ...finalizeSummary(item),
    })),
  )
  merged.channelDailyDistribution = sortDailyBreakdownList(
    merged.channelDailyDistribution.map((item) => ({
      date: item.date,
      key: item.key,
      label: item.label,
      ...finalizeSummary(item),
    })),
  )
  merged.modelDailyDistribution = sortDailyBreakdownList(
    merged.modelDailyDistribution.map((item) => ({
      date: item.date,
      key: item.key,
      label: item.label,
      ...finalizeSummary(item),
    })),
  )
  merged.daily = finalizeDailyStats(merged.daily, merged.userDailyDistribution)
  merged.summary = finalizeSummary(merged.summary, {
    activeUsers: merged.byUser.length,
    consumingUsers: merged.byUser.filter((item) => item.totalSpend > 0).length,
  })

  const resolvedStart = startOfDay(requestedRange[0])
  const resolvedEnd = endOfDay(requestedRange[1])
  merged.range = {
    startDate: resolvedStart.toISOString(),
    endDate: resolvedEnd.toISOString(),
    days: Math.max(1, Math.floor((resolvedEnd.getTime() - resolvedStart.getTime()) / DAY_MS) + 1),
  }

  return merged
}

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
  filterSelections.userIds = []
  filterSelections.models = []
  filterSelections.channels = []
  filterSelections.relayTokenIds = []
}

const userRegex = ref('')

const applyUserRegexSelection = () => {
  const regex = userRegex.value.trim()
  if (!regex) {
    ElMessage.warning(i18ns.t('ConsumptionStats.regexEmpty'))
    return
  }

  let re: RegExp
  try {
    re = new RegExp(regex, 'i')
  } catch {
    ElMessage.warning(i18ns.t('ConsumptionStats.invalidRegex'))
    return
  }

  const matched = stats.value.filterOptions.users
    .filter((opt) => re.test(opt.label))
    .map((opt) => opt.key)

  if (matched.length === 0) {
    ElMessage.warning(i18ns.t('ConsumptionStats.regexNoMatch'))
    return
  }

  filterSelections.userIds = matched
}

const selectAllFilter = (key: FilterSelectionKey, options: ConsumptionStatsFilterOption[]) => {
  filterSelections[key] = options.map((opt) => opt.key)
}

const invertFilterSelection = (
  key: FilterSelectionKey,
  options: ConsumptionStatsFilterOption[],
) => {
  const current = new Set(filterSelections[key])
  const allKeys = new Set(options.map((opt) => opt.key))
  filterSelections[key] = [...allKeys].filter((k) => !current.has(k))
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

const summaryCards = computed(() => [
  {
    key: 'totalSpend',
    label: i18ns.t('ConsumptionStats.totalSpend'),
    value: formatCurrency(stats.value.summary.totalSpend),
    hint: `${i18ns.t('ConsumptionStats.chargedSpend')}: ${formatCurrency(stats.value.summary.chargedSpend)}`,
  },
  {
    key: 'coveredSpend',
    label: i18ns.t('ConsumptionStats.coveredSpend'),
    value: formatCurrency(stats.value.summary.coveredSpend),
    hint: `${i18ns.t('ConsumptionStats.zeroChargeRequests')}: ${formatNumber(stats.value.summary.zeroChargeRequests)}`,
  },
  {
    key: 'consumingUsers',
    label: i18ns.t('ConsumptionStats.consumingUsers'),
    value: formatNumber(stats.value.summary.consumingUsers),
    hint: `${i18ns.t('ConsumptionStats.activeUsers')}: ${formatNumber(stats.value.summary.activeUsers)}`,
  },
  {
    key: 'requests',
    label: i18ns.t('ConsumptionStats.requests'),
    value: formatNumber(stats.value.summary.totalRequests),
    hint: `${i18ns.t('ConsumptionStats.avgSpendPerRequest')}: ${formatCurrency(stats.value.summary.avgSpendPerRequest)}`,
  },
  {
    key: 'tokens',
    label: i18ns.t('ConsumptionStats.tokens'),
    value: formatNumber(stats.value.summary.totalTokens),
    hint: `${i18ns.t('ConsumptionStats.avgTokensPerRequest')}: ${formatNumber(stats.value.summary.avgTokensPerRequest)}`,
  },
  {
    key: 'cacheTokens',
    label: i18ns.t('ConsumptionStats.cacheTokens'),
    value: formatNumber(
      stats.value.summary.cacheCreationTokens + stats.value.summary.cacheReadTokens,
    ),
    hint: `${i18ns.t('ConsumptionStats.inputOutputTokens')}: ${formatNumber(stats.value.summary.inputTokens)} / ${formatNumber(stats.value.summary.outputTokens)}`,
  },
])

const dailyTrendOption = computed(() => ({
  tooltip: { trigger: 'axis' },
  legend: { bottom: 0 },
  grid: { left: 40, right: 20, top: 20, bottom: 50 },
  xAxis: {
    type: 'category',
    data: stats.value.daily.map((item) => item.date),
  },
  yAxis: [
    {
      type: 'value',
      name: i18ns.t('ConsumptionStats.totalSpend'),
    },
    {
      type: 'value',
      name: i18ns.t('ConsumptionStats.requests'),
    },
  ],
  series: [
    {
      name: i18ns.t('ConsumptionStats.totalSpend'),
      type: 'line',
      smooth: true,
      data: stats.value.daily.map((item) => item.totalSpend),
    },
    {
      name: i18ns.t('ConsumptionStats.requests'),
      type: 'bar',
      yAxisIndex: 1,
      data: stats.value.daily.map((item) => item.totalRequests),
    },
    {
      name: i18ns.t('ConsumptionStats.consumingUsers'),
      type: 'line',
      smooth: true,
      yAxisIndex: 1,
      data: stats.value.daily.map((item) => item.consumingUsers),
    },
  ],
}))

const channelPieOption = computed(() => ({
  tooltip: { trigger: 'item' },
  legend: { orient: 'vertical', left: 0, top: 'middle' },
  series: [
    {
      name: i18ns.t('ConsumptionStats.channelDistribution'),
      type: 'pie',
      radius: ['40%', '70%'],
      center: ['65%', '50%'],
      data: stats.value.byChannel.slice(0, 8).map((item) => ({
        name: item.label,
        value: item.totalSpend,
      })),
      label: { formatter: '{b}: {d}%' },
    },
  ],
}))

const modelBarOption = computed(() => ({
  tooltip: { trigger: 'axis' },
  grid: { left: 40, right: 20, top: 20, bottom: 70 },
  xAxis: {
    type: 'category',
    axisLabel: { rotate: 35 },
    data: stats.value.byModel.slice(0, 10).map((item) => item.label),
  },
  yAxis: { type: 'value' },
  series: [
    {
      name: i18ns.t('ConsumptionStats.totalSpend'),
      type: 'bar',
      data: stats.value.byModel.slice(0, 10).map((item) => item.totalSpend),
    },
  ],
}))

const userBarOption = computed(() => ({
  tooltip: { trigger: 'axis' },
  grid: { left: 40, right: 20, top: 20, bottom: 70 },
  xAxis: {
    type: 'category',
    axisLabel: { rotate: 35 },
    data: stats.value.byUser.slice(0, 10).map((item) => item.label),
  },
  yAxis: { type: 'value' },
  series: [
    {
      name: i18ns.t('ConsumptionStats.totalSpend'),
      type: 'bar',
      data: stats.value.byUser.slice(0, 10).map((item) => item.totalSpend),
    },
  ],
}))

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
  userRegex.value = ''
  clearAllFilterSelections()
  await loadStats()
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
  userRegex,
  stats,
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

.filter-card {
  margin-bottom: 16px;
  border-radius: 10px;
}

.filter-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.filter-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.filter-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.filter-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.filter-count,
.filter-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.filter-actions,
.filter-header-actions,
.mobile-filter-actions,
.filter-tag-list {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.regex-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}

.filter-footer {
  margin-top: 12px;
}

.consumption-stats-container {
  max-width: 1400px;
  margin: 0 auto;
  padding: 0 20px 24px;
}

.summary-grid,
.chart-grid,
.table-grid {
  margin-bottom: 16px;
}

.summary-card,
.chart-card,
.table-card {
  border-radius: 10px;
}

.summary-card {
  min-height: 120px;
}

.summary-label {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  margin-bottom: 12px;
}

.summary-value {
  font-size: 24px;
  font-weight: 700;
  color: var(--el-text-color-primary);
  line-height: 1.2;
}

.summary-hint {
  margin-top: 10px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.card-header,
.table-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
}

.card-title {
  font-size: 15px;
  font-weight: 600;
}

.chart {
  height: 360px;
  width: 100%;
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

.mobile-filter-card {
  margin-bottom: 12px;
}

.mobile-filter-grid {
  grid-template-columns: 1fr;
}

.mobile-filter-actions {
  margin-top: 12px;
}

.mobile-regex-row {
  grid-template-columns: 1fr;
}

.mobile-summary-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
  margin-bottom: 12px;
}

.mobile-chart {
  height: 280px;
}

.mobile-collapse {
  margin-top: 12px;
}

@media (max-width: 768px) {
  .stats-toolbar {
    padding: 8px 10px;
  }

  .consumption-stats-container {
    padding: 0 10px 16px;
  }

  .filter-grid {
    grid-template-columns: 1fr;
  }

  .regex-row {
    grid-template-columns: 1fr;
  }
}
</style>
