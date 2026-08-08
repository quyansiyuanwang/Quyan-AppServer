<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Refresh, View } from '@element-plus/icons-vue'
import { i18ns } from '@/locales'
import { errorReportService } from '@/service/errorReportService'

const loading = ref(false)
const loadFailed = ref(false)
const rows = ref<any[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const status = ref<string | undefined>()
const source = ref<string | undefined>()
const search = ref('')
const activeGroup = ref<any | null>(null)
const occurrences = ref<any[]>([])
const detailVisible = ref(false)
const statusOptions = ['open', 'acknowledged', 'resolved', 'ignored'] as const

const statusLabel = (value: string) => {
  switch (value) {
    case 'open':
      return i18ns.t('errorCenter.statusOpen')
    case 'acknowledged':
      return i18ns.t('errorCenter.statusAcknowledged')
    case 'resolved':
      return i18ns.t('errorCenter.statusResolved')
    case 'ignored':
      return i18ns.t('errorCenter.statusIgnored')
    default:
      return value
  }
}

const sourceLabel = (value: string) => {
  if (value === 'frontend') return i18ns.t('errorCenter.sourceFrontend')
  if (value === 'backend') return i18ns.t('errorCenter.sourceBackend')
  return value
}

const load = async () => {
  loading.value = true
  loadFailed.value = false
  try {
    const data = await errorReportService.listGroups({
      page: page.value,
      pageSize: pageSize.value,
      resolutionStatus: status.value,
      source: source.value,
      search: search.value || undefined,
    })
    rows.value = data?.items ?? []
    total.value = data?.total ?? 0
  } catch {
    rows.value = []
    total.value = 0
    loadFailed.value = true
  } finally {
    loading.value = false
  }
}

const openDetail = async (row: any) => {
  activeGroup.value = await errorReportService.getGroup(row.id)
  const data = await errorReportService.listOccurrences(row.id, { page: 1, pageSize: 50 })
  occurrences.value = data.items
  detailVisible.value = true
}

const updateStatus = async (resolutionStatus: string) => {
  if (!activeGroup.value) return
  await errorReportService.updateStatus(activeGroup.value.id, resolutionStatus)
  activeGroup.value.resolutionStatus = resolutionStatus
  await load()
}

const resetPageAndLoad = () => {
  page.value = 1
  void load()
}

const clearFilters = () => {
  search.value = ''
  status.value = undefined
  source.value = undefined
  resetPageAndLoad()
}

onMounted(load)
</script>

<template>
  <section class="system-page error-center-page">
    <div class="page-toolbar">
      <div>
        <h2>{{ i18ns.t('errorCenter.title') }}</h2>
        <p>{{ i18ns.t('errorCenter.subtitle') }}</p>
      </div>
      <el-button :icon="Refresh" :loading="loading" @click="load">{{
        i18ns.t('refresh')
      }}</el-button>
    </div>

    <div class="filters" role="search">
      <div class="filter-field filter-search">
        <span class="filter-label">{{ i18ns.t('errorCenter.search') }}</span>
        <el-input
          v-model="search"
          clearable
          :placeholder="i18ns.t('errorCenter.searchPlaceholder')"
          @keyup.enter="resetPageAndLoad"
        />
      </div>
      <div class="filter-field">
        <span class="filter-label">{{ i18ns.t('errorCenter.status') }}</span>
        <el-select
          v-model="status"
          clearable
          :placeholder="i18ns.t('errorCenter.allStatuses')"
          @change="resetPageAndLoad"
        >
          <el-option
            v-for="item in statusOptions"
            :key="item"
            :label="statusLabel(item)"
            :value="item"
          />
        </el-select>
      </div>
      <div class="filter-field">
        <span class="filter-label">{{ i18ns.t('errorCenter.source') }}</span>
        <el-select
          v-model="source"
          clearable
          :placeholder="i18ns.t('errorCenter.allSources')"
          @change="resetPageAndLoad"
        >
          <el-option :label="sourceLabel('frontend')" value="frontend" />
          <el-option :label="sourceLabel('backend')" value="backend" />
        </el-select>
      </div>
      <el-button class="clear-filters" text @click="clearFilters">
        {{ i18ns.t('errorCenter.clearFilters') }}
      </el-button>
    </div>

    <el-table :data="rows" v-loading="loading" row-key="id">
      <template #empty>
        <el-empty
          :description="i18ns.t(loadFailed ? 'errorCenter.loadFailed' : 'errorCenter.empty')"
        >
          <el-button v-if="loadFailed" type="primary" @click="load">
            {{ i18ns.t('reload') }}
          </el-button>
        </el-empty>
      </template>
      <el-table-column prop="lastSeenAt" :label="i18ns.t('errorCenter.lastSeen')" width="180">
        <template #default="{ row }">{{ new Date(row.lastSeenAt).toLocaleString() }}</template>
      </el-table-column>
      <el-table-column prop="source" :label="i18ns.t('errorCenter.source')" width="100">
        <template #default="{ row }">{{ sourceLabel(row.source) }}</template>
      </el-table-column>
      <el-table-column prop="resolutionStatus" :label="i18ns.t('errorCenter.status')" width="130">
        <template #default="{ row }"
          ><el-tag :type="row.resolutionStatus === 'open' ? 'danger' : 'info'">{{
            statusLabel(row.resolutionStatus)
          }}</el-tag></template
        >
      </el-table-column>
      <el-table-column
        prop="route"
        :label="i18ns.t('errorCenter.route')"
        min-width="180"
        show-overflow-tooltip
      />
      <el-table-column
        prop="message"
        :label="i18ns.t('errorCenter.message')"
        min-width="260"
        show-overflow-tooltip
      />
      <el-table-column prop="occurrenceCount" :label="i18ns.t('errorCenter.count')" width="100" />
      <el-table-column width="70" fixed="right">
        <template #default="{ row }"
          ><el-button
            text
            :icon="View"
            :title="i18ns.t('errorCenter.view')"
            @click="openDetail(row)"
        /></template>
      </el-table-column>
    </el-table>
    <el-pagination
      v-model:current-page="page"
      v-model:page-size="pageSize"
      :total="total"
      layout="total, sizes, prev, pager, next"
      @change="load"
    />

    <el-drawer
      v-model="detailVisible"
      size="min(760px, 100%)"
      :title="i18ns.t('errorCenter.detail')"
    >
      <template v-if="activeGroup">
        <div class="detail-actions">
          <el-button
            v-for="item in statusOptions"
            :key="item"
            size="small"
            @click="updateStatus(item)"
            >{{ statusLabel(item) }}</el-button
          >
        </div>
        <el-descriptions :column="1" border>
          <el-descriptions-item :label="i18ns.t('errorCenter.message')">{{
            activeGroup.message
          }}</el-descriptions-item>
          <el-descriptions-item :label="i18ns.t('errorCenter.fingerprint')">{{
            activeGroup.fingerprint
          }}</el-descriptions-item>
        </el-descriptions>
        <h3>{{ i18ns.t('errorCenter.occurrences') }}</h3>
        <el-collapse>
          <el-collapse-item
            v-for="item in occurrences"
            :key="item.id"
            :title="new Date(item.createTime).toLocaleString()"
          >
            <pre v-if="item.stack">{{ item.stack }}</pre>
            <pre v-if="item.context">{{ JSON.stringify(item.context, null, 2) }}</pre>
          </el-collapse-item>
        </el-collapse>
      </template>
    </el-drawer>
  </section>
</template>

<style scoped>
.system-page {
  display: grid;
  gap: 16px;
  padding: 20px;
}
.page-toolbar,
.filters,
.detail-actions {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
}
.page-toolbar h2,
.page-toolbar p {
  margin: 0;
}
.page-toolbar p {
  color: var(--el-text-color-secondary);
  margin-top: 4px;
}
.filters {
  display: grid;
  grid-template-columns: minmax(240px, 1fr) minmax(150px, 180px) minmax(150px, 180px) auto;
  gap: 12px 16px;
  align-items: end;
  justify-content: initial;
}
.filter-field {
  display: grid;
  min-width: 0;
  gap: 6px;
}
.filter-label {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.2;
}
.filter-field :deep(.el-input),
.filter-field :deep(.el-select) {
  width: 100%;
}
.clear-filters {
  min-height: 32px;
  padding-inline: 4px;
}
pre {
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
}
@media (max-width: 700px) {
  .page-toolbar {
    align-items: flex-start;
  }
  .filters {
    grid-template-columns: 1fr;
  }
  .clear-filters {
    justify-self: start;
  }
}
</style>
