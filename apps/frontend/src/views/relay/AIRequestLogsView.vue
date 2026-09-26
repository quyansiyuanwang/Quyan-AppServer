<template>
  <main class="ai-request-logs-page">
    <header class="page-header">
      <div>
        <h1>{{ i18ns.t('aiRequestLogs.title') }}</h1>
        <p>{{ i18ns.t('aiRequestLogs.description') }}</p>
      </div>
      <el-button :icon="Refresh" :loading="loading" @click="load">
        {{ i18ns.t('refresh') }}
      </el-button>
    </header>

    <el-alert type="info" :closable="false" show-icon>
      {{ i18ns.t('aiRequestLogs.retentionNotice') }}
    </el-alert>
    <el-alert v-if="error" type="error" :closable="false" show-icon>{{ error }}</el-alert>

    <section class="filter-panel">
      <el-date-picker
        v-model="filters.dateRange"
        type="datetimerange"
        value-format="YYYY-MM-DD HH:mm:ss"
        start-placeholder="开始时间"
        end-placeholder="结束时间"
      />
      <el-input v-model="filters.user" clearable :placeholder="i18ns.t('aiRequestLogs.user')" />
      <el-input
        v-model="filters.relayToken"
        clearable
        :placeholder="i18ns.t('aiRequestLogs.token')"
      />
      <el-input v-model="filters.model" clearable :placeholder="i18ns.t('aiRequestLogs.model')" />
      <el-input
        v-model="filters.requestFormat"
        clearable
        :placeholder="i18ns.t('aiRequestLogs.format')"
      />
      <el-input
        v-model="filters.requestId"
        clearable
        :placeholder="i18ns.t('aiRequestLogs.requestId')"
      />
      <el-input
        v-model="filters.keyword"
        clearable
        :placeholder="i18ns.t('aiRequestLogs.keyword')"
        @keyup.enter="search"
      />
      <el-input
        v-model="filters.statusCode"
        clearable
        :placeholder="i18ns.t('aiRequestLogs.statusCode')"
      />
      <el-select
        v-model="filters.truncated"
        clearable
        :placeholder="i18ns.t('aiRequestLogs.truncated')"
      >
        <el-option value="true" :label="i18ns.t('aiRequestLogs.truncatedYes')" />
        <el-option value="false" :label="i18ns.t('aiRequestLogs.truncatedNo')" />
      </el-select>
      <div class="filter-actions">
        <el-button type="primary" :icon="Search" @click="search">{{ i18ns.t('search') }}</el-button>
        <el-button @click="resetFilters">{{ i18ns.t('reset') }}</el-button>
      </div>
    </section>

    <el-table v-loading="loading" :data="records" row-key="id" @row-click="openDetail">
      <el-table-column :label="i18ns.t('aiRequestLogs.time')" width="180">
        <template #default="{ row }">{{ formatTime(row.createTime) }}</template>
      </el-table-column>
      <el-table-column prop="username" :label="i18ns.t('aiRequestLogs.user')" min-width="120" />
      <el-table-column
        prop="relayTokenName"
        :label="i18ns.t('aiRequestLogs.token')"
        min-width="140"
        show-overflow-tooltip
      />
      <el-table-column
        prop="model"
        :label="i18ns.t('aiRequestLogs.model')"
        min-width="150"
        show-overflow-tooltip
      />
      <el-table-column
        prop="requestFormat"
        :label="i18ns.t('aiRequestLogs.format')"
        min-width="150"
        show-overflow-tooltip
      />
      <el-table-column :label="i18ns.t('aiRequestLogs.statusCode')" width="90" align="center">
        <template #default="{ row }">
          <el-tag :type="statusType(row.statusCode)">{{ row.statusCode }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column :label="i18ns.t('aiRequestLogs.duration')" width="100" align="right">
        <template #default="{ row }">{{ row.durationMs }} ms</template>
      </el-table-column>
      <el-table-column :label="i18ns.t('aiRequestLogs.contentSize')" width="150" align="right">
        <template #default="{ row }">
          {{ formatBytes(row.requestSizeBytes) }} / {{ formatBytes(row.responseSizeBytes) }}
        </template>
      </el-table-column>
      <el-table-column :label="i18ns.t('aiRequestLogs.flags')" width="100" align="center">
        <template #default="{ row }">
          <el-tag v-if="row.requestTruncated || row.responseTruncated" type="warning" size="small">
            {{ i18ns.t('aiRequestLogs.truncatedShort') }}
          </el-tag>
          <span v-else>-</span>
        </template>
      </el-table-column>
      <el-table-column
        :label="i18ns.t('aiRequestLogs.requestId')"
        min-width="245"
        show-overflow-tooltip
      >
        <template #default="{ row }"
          ><code>{{ row.requestId }}</code></template
        >
      </el-table-column>
      <el-table-column :label="i18ns.t('aiRequestLogs.actions')" width="90" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click.stop="openDetail(row)">{{
            i18ns.t('aiRequestLogs.detail')
          }}</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-pagination
      v-model:current-page="page"
      v-model:page-size="pageSize"
      :total="total"
      :page-sizes="[20, 50, 100]"
      layout="total, sizes, prev, pager, next"
      @change="load"
    />

    <el-drawer
      v-model="drawerVisible"
      size="min(960px, 100vw)"
      :title="selected?.requestId || i18ns.t('aiRequestLogs.detail')"
    >
      <div v-if="selected" v-loading="detailLoading" class="detail-content">
        <el-descriptions :column="2" border>
          <el-descriptions-item :label="i18ns.t('aiRequestLogs.user')">{{
            selected.username || selected.userId || '-'
          }}</el-descriptions-item>
          <el-descriptions-item :label="i18ns.t('aiRequestLogs.token')">{{
            selected.relayTokenName || selected.relayTokenId || '-'
          }}</el-descriptions-item>
          <el-descriptions-item :label="i18ns.t('aiRequestLogs.model')">{{
            selected.model || '-'
          }}</el-descriptions-item>
          <el-descriptions-item :label="i18ns.t('aiRequestLogs.format')">{{
            selected.requestFormat || '-'
          }}</el-descriptions-item>
          <el-descriptions-item :label="i18ns.t('aiRequestLogs.path')"
            >{{ selected.method }} {{ selected.path }}</el-descriptions-item
          >
          <el-descriptions-item :label="i18ns.t('aiRequestLogs.ipAddress')">{{
            selected.ipAddress
          }}</el-descriptions-item>
          <el-descriptions-item :label="i18ns.t('aiRequestLogs.time')">{{
            formatTime(selected.createTime)
          }}</el-descriptions-item>
          <el-descriptions-item :label="i18ns.t('aiRequestLogs.userAgent')">{{
            selected.userAgent || '-'
          }}</el-descriptions-item>
        </el-descriptions>

        <el-alert
          v-if="selected.requestTruncated || selected.responseTruncated"
          type="warning"
          :closable="false"
          show-icon
        >
          {{ i18ns.t('aiRequestLogs.truncatedDetail') }}
        </el-alert>

        <el-tabs v-model="activeTab">
          <el-tab-pane :label="i18ns.t('aiRequestLogs.requestBody')" name="request">
            <div class="payload-toolbar">
              <span>{{ formatBytes(selected.requestSizeBytes) }}</span>
              <el-button :icon="CopyDocument" @click="copyPayload(requestPayload)">{{
                i18ns.t('copy')
              }}</el-button>
            </div>
            <pre class="payload">{{ requestPayload || '-' }}</pre>
          </el-tab-pane>
          <el-tab-pane :label="i18ns.t('aiRequestLogs.responseBody')" name="response">
            <div class="payload-toolbar">
              <span>{{ formatBytes(selected.responseSizeBytes) }}</span>
              <el-button :icon="CopyDocument" @click="copyPayload(responsePayload)">{{
                i18ns.t('copy')
              }}</el-button>
            </div>
            <pre class="payload">{{ responsePayload || '-' }}</pre>
          </el-tab-pane>
        </el-tabs>
      </div>
    </el-drawer>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { CopyDocument, Refresh, Search } from '@element-plus/icons-vue'
import type { AiRequestLogDetailDto, AiRequestLogListItemDto } from '@/client/types.gen'
import { aiRequestLogService } from '@/service/aiRequestLogService'
import { i18ns } from '@/locales'
import { getErrorMessage } from '@/utils/error-utils'
import { ElMessage } from '@/utils/elementPlusRuntime'

const loading = ref(false)
const error = ref('')
const records = ref<AiRequestLogListItemDto[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const drawerVisible = ref(false)
const selected = ref<AiRequestLogDetailDto | null>(null)
const detailLoading = ref(false)
const activeTab = ref('request')

type FilterState = {
  dateRange: [string, string] | null
  user: string
  relayToken: string
  model: string
  requestFormat: string
  requestId: string
  keyword: string
  statusCode: string
  truncated: '' | 'true' | 'false'
}

const formatDateTime = (value: Date) => {
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`
}

const defaultDateRange = (): [string, string] => {
  const end = new Date()
  const start = new Date(end.getTime() - 90 * 24 * 60 * 60 * 1000)
  return [formatDateTime(start), formatDateTime(end)]
}

const filters = ref<FilterState>({
  dateRange: defaultDateRange(),
  user: '',
  relayToken: '',
  model: '',
  requestFormat: '',
  requestId: '',
  keyword: '',
  statusCode: '',
  truncated: '',
})

const formatTime = (value: string) => new Date(value).toLocaleString()
const formatBytes = (value: number | null | undefined) => {
  if (value === null || value === undefined) return '-'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(2)} MB`
}

const statusType = (status: number) =>
  status < 400 ? 'success' : status < 500 ? 'warning' : 'danger'
const formatPayload = (value: unknown) => {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

const requestPayload = computed(() => formatPayload(selected.value?.requestBody))
const responsePayload = computed(() => formatPayload(selected.value?.responseBody))

const load = async () => {
  loading.value = true
  error.value = ''
  try {
    const statusCode = filters.value.statusCode ? Number(filters.value.statusCode) : undefined
    const result = await aiRequestLogService.list({
      page: page.value,
      pageSize: pageSize.value,
      startDate: filters.value.dateRange?.[0],
      endDate: filters.value.dateRange?.[1],
      user: filters.value.user || undefined,
      relayToken: filters.value.relayToken || undefined,
      model: filters.value.model || undefined,
      requestFormat: filters.value.requestFormat || undefined,
      requestId: filters.value.requestId || undefined,
      keyword: filters.value.keyword || undefined,
      statusCode,
      truncated: filters.value.truncated === '' ? undefined : filters.value.truncated === 'true',
    })
    records.value = result.items || []
    total.value = result.total || 0
  } catch (cause) {
    records.value = []
    total.value = 0
    error.value = getErrorMessage(cause, i18ns.t('aiRequestLogs.loadFailed'))
  } finally {
    loading.value = false
  }
}

const search = () => {
  page.value = 1
  void load()
}

const resetFilters = () => {
  filters.value = {
    dateRange: defaultDateRange(),
    user: '',
    relayToken: '',
    model: '',
    requestFormat: '',
    requestId: '',
    keyword: '',
    statusCode: '',
    truncated: '',
  }
  search()
}

const openDetail = async (row: AiRequestLogListItemDto) => {
  drawerVisible.value = true
  activeTab.value = 'request'
  detailLoading.value = true
  selected.value = { ...row, requestBody: null, responseBody: null }
  try {
    selected.value = await aiRequestLogService.detail(row.id)
  } catch (cause) {
    ElMessage.error(getErrorMessage(cause, i18ns.t('aiRequestLogs.detailLoadFailed')))
  } finally {
    detailLoading.value = false
  }
}

const copyPayload = async (value: string) => {
  if (!value) return
  await navigator.clipboard.writeText(value)
  ElMessage.success(i18ns.t('aiRequestLogs.copied'))
}

onMounted(load)
</script>

<style scoped>
.ai-request-logs-page {
  display: grid;
  gap: 16px;
  padding: 24px;
  min-width: 0;
}
.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.page-header h1,
.page-header p {
  margin: 0;
}
.page-header p {
  margin-top: 6px;
  color: var(--el-text-color-secondary);
}
.filter-panel {
  display: grid;
  grid-template-columns: repeat(4, minmax(160px, 1fr));
  gap: 10px;
}
.filter-actions {
  display: flex;
  gap: 8px;
}
.detail-content {
  display: grid;
  gap: 16px;
}
.payload-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  color: var(--el-text-color-secondary);
}
.payload {
  max-height: 55vh;
  margin: 0;
  padding: 16px;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  background: var(--el-fill-color-light);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.6;
}
@media (max-width: 1100px) {
  .filter-panel {
    grid-template-columns: repeat(2, minmax(160px, 1fr));
  }
}
@media (max-width: 720px) {
  .ai-request-logs-page {
    padding: 16px;
  }
  .page-header {
    align-items: center;
  }
  .page-header p {
    display: none;
  }
  .filter-panel {
    grid-template-columns: 1fr;
  }
}
</style>
