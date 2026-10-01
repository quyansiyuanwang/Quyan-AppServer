<template>
  <main class="ai-request-logs-page">
    <header class="page-header">
      <div>
        <h1>{{ i18ns.t('aiRequestLogs.title') }}</h1>
        <p>{{ i18ns.t('aiRequestLogs.description') }}</p>
      </div>
      <el-button :icon="Refresh" :loading="loading" @click="load">{{
        i18ns.t('refresh')
      }}</el-button>
    </header>
    <el-alert type="info" :closable="false" show-icon>{{
      i18ns.t('aiRequestLogs.retentionNotice')
    }}</el-alert>
    <el-alert v-if="error" type="error" :closable="false" show-icon>{{ error }}</el-alert>
    <form class="filter-panel" @submit.prevent="search">
      <div class="primary-search">
        <el-input
          v-model="filters.keyword"
          clearable
          :prefix-icon="Search"
          :maxlength="500"
          :placeholder="i18ns.t('aiRequestLogs.keyword')"
        /><el-button type="primary" native-type="submit" :icon="Search">{{
          i18ns.t('search')
        }}</el-button
        ><el-button @click="resetFilters">{{ i18ns.t('reset') }}</el-button>
      </div>
      <div class="common-filters">
        <el-date-picker
          v-model="filters.dateRange"
          type="datetimerange"
          :shortcuts="dateShortcuts"
          :start-placeholder="i18ns.t('aiRequestLogs.startTime')"
          :end-placeholder="i18ns.t('aiRequestLogs.endTime')"
        />
        <el-input
          v-model="filters.user"
          clearable
          :placeholder="i18ns.t('aiRequestLogs.user') + ' / ID'"
          :maxlength="191"
        /><el-input
          v-model="filters.relayToken"
          clearable
          :placeholder="i18ns.t('aiRequestLogs.token') + ' / ID'"
          :maxlength="191"
        />
        <el-select
          v-model="filters.outcome"
          clearable
          :placeholder="i18ns.t('aiRequestLogs.outcome')"
          ><el-option
            v-for="value in outcomes"
            :key="value"
            :value="value"
            :label="outcomeLabel(value)"
        /></el-select>
      </div>
      <el-button link @click="advanced = !advanced"
        >{{ i18ns.t('aiRequestLogs.advancedFilters') }} {{ advanced ? '−' : '+' }}</el-button
      >
      <div v-if="advanced" class="advanced-filters">
        <el-input
          v-model="filters.model"
          clearable
          :placeholder="i18ns.t('aiRequestLogs.model')"
          :maxlength="160"
        />
        <el-select
          v-model="filters.requestFormat"
          clearable
          :placeholder="i18ns.t('aiRequestLogs.format')"
          ><el-option
            v-for="format in RELAY_REQUEST_FORMATS"
            :key="format"
            :value="format"
            :label="format"
        /></el-select>
        <el-input
          v-model="filters.requestId"
          clearable
          :placeholder="i18ns.t('aiRequestLogs.requestId')"
          :maxlength="64"
        /><el-input
          v-model="filters.statusCode"
          clearable
          :placeholder="i18ns.t('aiRequestLogs.statusCode')"
          inputmode="numeric"
        />
        <el-select
          v-model="filters.truncated"
          clearable
          :placeholder="i18ns.t('aiRequestLogs.truncated')"
          ><el-option value="true" :label="i18ns.t('aiRequestLogs.truncatedYes')" /><el-option
            value="false"
            :label="i18ns.t('aiRequestLogs.truncatedNo')"
        /></el-select>
        <el-select
          v-model="filters.isStreaming"
          clearable
          :placeholder="i18ns.t('aiRequestLogs.streaming')"
          ><el-option value="true" :label="i18ns.t('yes')" /><el-option
            value="false"
            :label="i18ns.t('no')"
        /></el-select>
        <el-select
          v-model="filters.failureStage"
          clearable
          :placeholder="i18ns.t('aiRequestLogs.failureStage')"
          ><el-option
            v-for="stage in stages"
            :key="stage"
            :value="stage"
            :label="stageLabel(stage)"
        /></el-select>
        <el-select
          v-model="filters.bodyOmissionReason"
          clearable
          :placeholder="i18ns.t('aiRequestLogs.omitted')"
          ><el-option
            v-for="reason in omissions"
            :key="reason"
            :value="reason"
            :label="omissionLabel(reason)"
        /></el-select>
        <el-input
          v-model="filters.ipAddress"
          clearable
          :placeholder="i18ns.t('aiRequestLogs.ipAddress')"
          :maxlength="128"
        /><el-input
          v-model="filters.minDurationMs"
          clearable
          :placeholder="i18ns.t('aiRequestLogs.minDuration')"
          inputmode="numeric"
        /><el-input
          v-model="filters.maxDurationMs"
          clearable
          :placeholder="i18ns.t('aiRequestLogs.maxDuration')"
          inputmode="numeric"
        />
      </div>
    </form>
    <el-table v-loading="loading" :data="records" row-key="id" @row-click="openDetail">
      <el-table-column :label="i18ns.t('aiRequestLogs.time')" width="180"
        ><template #default="{ row }">{{
          new Date(row.createTime).toLocaleString()
        }}</template></el-table-column
      >
      <el-table-column :label="i18ns.t('aiRequestLogs.user')" min-width="140" show-overflow-tooltip
        ><template #default="{ row }">{{ identityLabel(row) }}</template></el-table-column
      >
      <el-table-column :label="i18ns.t('aiRequestLogs.token')" min-width="170" show-overflow-tooltip
        ><template #default="{ row }">{{ tokenLabel(row) }}</template></el-table-column
      >
      <el-table-column
        prop="model"
        :label="i18ns.t('aiRequestLogs.model')"
        min-width="160"
        show-overflow-tooltip
      />
      <el-table-column
        prop="requestFormat"
        :label="i18ns.t('aiRequestLogs.format')"
        min-width="160"
      />
      <el-table-column :label="i18ns.t('aiRequestLogs.outcome')" width="130"
        ><template #default="{ row }"
          ><el-tag
            :type="
              row.outcome === 'failed' || row.outcome === 'interrupted'
                ? 'danger'
                : row.outcome === 'success'
                  ? 'success'
                  : 'info'
            "
            >{{ outcomeLabel(row.outcome) }}</el-tag
          ><small class="http-status">HTTP {{ row.statusCode }}</small></template
        ></el-table-column
      >
      <el-table-column :label="i18ns.t('aiRequestLogs.duration')" width="110" align="right"
        ><template #default="{ row }">{{ row.durationMs }} ms</template></el-table-column
      >
      <el-table-column :label="i18ns.t('aiRequestLogs.contentSize')" width="175" align="right"
        ><template #default="{ row }"
          >{{ formatBytes(row.requestSizeBytes) }} /
          {{ formatBytes(row.responseSizeBytes) }}</template
        ></el-table-column
      >
      <el-table-column :label="i18ns.t('aiRequestLogs.flags')" width="110"
        ><template #default="{ row }"
          ><el-tag
            v-if="row.requestTruncated || row.responseTruncated"
            type="warning"
            size="small"
            >{{ i18ns.t('aiRequestLogs.truncatedShort') }}</el-tag
          ><el-tag v-if="row.bodyOmissionReason" type="info" size="small">{{
            i18ns.t('aiRequestLogs.omitted')
          }}</el-tag></template
        ></el-table-column
      >
      <el-table-column
        prop="requestId"
        :label="i18ns.t('aiRequestLogs.requestId')"
        min-width="250"
        show-overflow-tooltip
      />
      <el-table-column :label="i18ns.t('aiRequestLogs.actions')" width="90" fixed="right"
        ><template #default="{ row }"
          ><el-button link type="primary" @click.stop="openDetail(row)">{{
            i18ns.t('aiRequestLogs.detail')
          }}</el-button></template
        ></el-table-column
      >
    </el-table>
    <el-pagination
      v-model:current-page="page"
      v-model:page-size="pageSize"
      :page-sizes="[20, 50, 100]"
      :total="total"
      layout="total, sizes, prev, pager, next"
      @current-change="load"
      @size-change="changePageSize"
    />
    <el-drawer
      v-model="drawerVisible"
      :title="i18ns.t('aiRequestLogs.detail')"
      size="min(1100px, 96vw)"
      destroy-on-close
      @closed="selected = null"
      ><AIRequestLogDetail v-if="selected" :key="selected.id" :row="selected"
    /></el-drawer>
  </main>
</template>
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { Refresh, Search } from '@element-plus/icons-vue'
import { RELAY_REQUEST_FORMATS } from '@quyan/shared'
import type { AiRequestLogListItemDto } from '@/client/types.gen'
import { aiRequestLogService, type AIRequestLogFilters } from '@/service/aiRequestLogService'
import { i18ns } from '@/locales'
import { getErrorMessage } from '@/utils/error-utils'
import AIRequestLogDetail from './ai-request-logs/AIRequestLogDetail.vue'
import {
  formatBytes,
  identityLabel,
  omissionLabel,
  outcomeLabel,
  outcomeKeys,
  stageKeys,
  omissionKeys,
  stageLabel,
  tokenLabel,
} from './ai-request-logs/logPresentation'
const loading = ref(false)
const error = ref('')
const records = shallowRef<AiRequestLogListItemDto[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const drawerVisible = ref(false)
const selected = shallowRef<AiRequestLogListItemDto | null>(null)
const advanced = ref(false)
const outcomes = Object.keys(outcomeKeys) as Array<NonNullable<AIRequestLogFilters['outcome']>>
const stages = Object.keys(stageKeys) as Array<NonNullable<AIRequestLogFilters['failureStage']>>
const omissions = Object.keys(omissionKeys) as Array<
  NonNullable<AIRequestLogFilters['bodyOmissionReason']>
>
const defaultFilters = () => ({
  dateRange: [new Date(Date.now() - 24 * 60 * 60 * 1000), new Date()] as [Date, Date] | null,
  user: '',
  relayToken: '',
  model: '',
  requestFormat: '',
  requestId: '',
  keyword: '',
  statusCode: '',
  truncated: '',
  outcome: '' as NonNullable<AIRequestLogFilters['outcome']> | '',
  isStreaming: '',
  failureStage: '' as NonNullable<AIRequestLogFilters['failureStage']> | '',
  bodyOmissionReason: '' as NonNullable<AIRequestLogFilters['bodyOmissionReason']> | '',
  ipAddress: '',
  minDurationMs: '',
  maxDurationMs: '',
})
const filters = ref(defaultFilters())
const dateShortcuts = [
  { text: i18ns.t('aiRequestLogs.lastHour'), hours: 1 },
  { text: i18ns.t('aiRequestLogs.lastDay'), hours: 24 },
  { text: i18ns.t('aiRequestLogs.lastWeek'), hours: 24 * 7 },
  { text: i18ns.t('aiRequestLogs.lastMonth'), hours: 24 * 30 },
].map(({ text, hours }) => ({
  text,
  value: () => [new Date(Date.now() - hours * 60 * 60 * 1000), new Date()],
}))
let controller: AbortController | null = null
const load = async () => {
  controller?.abort()
  controller = new AbortController()
  const signal = controller.signal
  const statusCode = filters.value.statusCode ? Number(filters.value.statusCode) : undefined
  const minDurationMs = filters.value.minDurationMs
    ? Number(filters.value.minDurationMs)
    : undefined
  const maxDurationMs = filters.value.maxDurationMs
    ? Number(filters.value.maxDurationMs)
    : undefined
  const dates = filters.value.dateRange?.map((date) => new Date(date))
  const invalid =
    (statusCode !== undefined &&
      (!Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599)) ||
    [minDurationMs, maxDurationMs].some(
      (value) =>
        value !== undefined && (!Number.isInteger(value) || value < 0 || value > 2147483647),
    ) ||
    (minDurationMs !== undefined && maxDurationMs !== undefined && minDurationMs > maxDurationMs) ||
    (dates && (dates.some((date) => Number.isNaN(date.getTime())) || dates[0]! > dates[1]!))
  if (invalid) {
    error.value = i18ns.t('aiRequestLogs.invalidFilters')
    loading.value = false
    return
  }
  loading.value = true
  error.value = ''
  try {
    const result = await aiRequestLogService.list(
      {
        page: page.value,
        pageSize: pageSize.value,
        startDate: dates?.[0]?.toISOString(),
        endDate: dates?.[1]?.toISOString(),
        user: filters.value.user || undefined,
        relayToken: filters.value.relayToken || undefined,
        model: filters.value.model || undefined,
        requestFormat: filters.value.requestFormat || undefined,
        requestId: filters.value.requestId || undefined,
        keyword: filters.value.keyword || undefined,
        statusCode,
        truncated: filters.value.truncated ? filters.value.truncated === 'true' : undefined,
        outcome: filters.value.outcome || undefined,
        isStreaming: filters.value.isStreaming ? filters.value.isStreaming === 'true' : undefined,
        failureStage: filters.value.failureStage || undefined,
        bodyOmissionReason: filters.value.bodyOmissionReason || undefined,
        ipAddress: filters.value.ipAddress || undefined,
        minDurationMs,
        maxDurationMs,
      },
      signal,
    )
    if (!signal.aborted) {
      records.value = result.items || []
      total.value = result.total || 0
    }
  } catch (cause) {
    if (!signal.aborted) {
      records.value = []
      total.value = 0
      error.value = getErrorMessage(cause, i18ns.t('aiRequestLogs.loadFailed'))
    }
  } finally {
    if (!signal.aborted) loading.value = false
  }
}
const search = () => {
  page.value = 1
  void load()
}
const resetFilters = () => {
  filters.value = defaultFilters()
  search()
}
const changePageSize = () => {
  page.value = 1
  void load()
}
const openDetail = (row: AiRequestLogListItemDto) => {
  selected.value = row
  drawerVisible.value = true
}
onMounted(load)
onBeforeUnmount(() => controller?.abort())
</script>
<style scoped lang="scss">
.ai-request-logs-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 24px;
}
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.page-header h1 {
  font-size: 24px;
  margin: 0 0 8px;
}
.page-header p {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.filter-panel {
  border: 1px solid var(--el-border-color);
  padding: 16px;
  border-radius: 10px;
  background: var(--el-bg-color);
}
.primary-search {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.primary-search > :first-child {
  flex: 1;
}
.common-filters {
  display: grid;
  grid-template-columns: minmax(330px, 2fr) repeat(3, minmax(140px, 1fr));
  gap: 10px;
  margin-bottom: 8px;
}
.advanced-filters {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-top: 12px;
}
.common-filters :deep(.el-date-editor) {
  width: 100%;
}
.http-status {
  display: block;
  font-size: 11px;
  color: var(--el-text-color-secondary);
  margin-top: 3px;
}
.el-pagination {
  justify-content: flex-end;
}
@media (max-width: 1000px) {
  .common-filters {
    grid-template-columns: 1fr 1fr;
  }
  .advanced-filters {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
@media (max-width: 640px) {
  .ai-request-logs-page {
    padding: 12px;
  }
  .page-header {
    align-items: flex-start;
  }
  .common-filters,
  .advanced-filters {
    grid-template-columns: 1fr;
  }
  .primary-search {
    flex-wrap: wrap;
  }
  .primary-search > :first-child {
    flex-basis: 100%;
  }
  .el-pagination {
    overflow: auto;
    justify-content: flex-start;
  }
}
</style>
