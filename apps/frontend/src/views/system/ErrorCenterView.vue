<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import { i18ns } from '@/locales'
import { errorReportService } from '@/service/errorReportService'
import { highlightCodeBlocks } from '@/utils/asyncMarkdown'
import 'highlight.js/styles/github-dark.css'

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
const detailLoading = ref(false)
const occurrenceLoadFailed = ref(false)
const detailContent = ref<HTMLElement | null>(null)
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
  activeGroup.value = row
  occurrences.value = []
  occurrenceLoadFailed.value = false
  detailVisible.value = true
  detailLoading.value = true
  try {
    activeGroup.value = await errorReportService.getGroup(row.id)
  } finally {
    detailLoading.value = false
  }

  try {
    const data = await errorReportService.listOccurrences(row.id, { page: 1, pageSize: 50 })
    occurrences.value = data?.items ?? []
  } catch {
    occurrenceLoadFailed.value = true
  }
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

const highlightDetailCode = async () => {
  await nextTick()
  await highlightCodeBlocks(detailContent.value)
}

watch([detailVisible, activeGroup, occurrences], ([visible]) => {
  if (visible) void highlightDetailCode()
})

onMounted(load)
</script>

<template>
  <section class="system-page error-center-page">
    <div class="page-toolbar">
      <div>
        <h2>{{ i18ns.t('errorCenter.title') }}</h2>
        <p>{{ i18ns.t('errorCenter.subtitle') }}</p>
      </div>
      <el-button :loading="loading" @click="load">{{ i18ns.t('refresh') }}</el-button>
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
        <template #default="{ row }">
          <el-button text @click="openDetail(row)">
            {{ i18ns.t('errorCenter.view') }}
          </el-button>
        </template>
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
      <div v-if="activeGroup" ref="detailContent" v-loading="detailLoading" class="error-detail">
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
          <el-descriptions-item :label="i18ns.t('errorCenter.type')">
            {{ activeGroup.errorType }}
          </el-descriptions-item>
          <el-descriptions-item :label="i18ns.t('errorCenter.source')">
            {{ sourceLabel(activeGroup.source) }}
          </el-descriptions-item>
          <el-descriptions-item :label="i18ns.t('errorCenter.status')">
            {{ statusLabel(activeGroup.resolutionStatus) }}
          </el-descriptions-item>
          <el-descriptions-item :label="i18ns.t('errorCenter.route')">
            {{ activeGroup.route || '-' }}
          </el-descriptions-item>
          <el-descriptions-item :label="i18ns.t('errorCenter.fingerprint')">{{
            activeGroup.fingerprint
          }}</el-descriptions-item>
        </el-descriptions>
        <section class="detail-section">
          <h3>{{ i18ns.t('errorCenter.message') }}</h3>
          <pre
            class="code-panel"
          ><code class="language-typescript">{{ activeGroup.message }}</code></pre>
        </section>
        <section class="detail-section">
          <h3>{{ i18ns.t('errorCenter.occurrences') }}</h3>
          <el-alert
            v-if="occurrenceLoadFailed"
            type="warning"
            :title="i18ns.t('errorCenter.occurrencesLoadFailed')"
            :closable="false"
            show-icon
          />
          <el-empty
            v-else-if="!detailLoading && occurrences.length === 0"
            :description="i18ns.t('errorCenter.noOccurrences')"
          />
          <el-collapse v-else @change="() => void highlightDetailCode()">
            <el-collapse-item
              v-for="item in occurrences"
              :key="item.id"
              :title="new Date(item.createTime).toLocaleString()"
            >
              <section v-if="item.stack" class="occurrence-section">
                <h4>{{ i18ns.t('errorCenter.stack') }}</h4>
                <pre
                  class="code-panel"
                ><code class="language-typescript">{{ item.stack }}</code></pre>
              </section>
              <section v-if="item.context" class="occurrence-section">
                <h4>{{ i18ns.t('errorCenter.context') }}</h4>
                <pre
                  class="code-panel"
                ><code class="language-json">{{ JSON.stringify(item.context, null, 2) }}</code></pre>
              </section>
            </el-collapse-item>
          </el-collapse>
        </section>
      </div>
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
  margin: 0;
}
.error-detail {
  display: grid;
  gap: 20px;
}
.detail-section,
.occurrence-section {
  display: grid;
  gap: 8px;
}
.detail-section h3,
.occurrence-section h4 {
  margin: 0;
}
.occurrence-section + .occurrence-section {
  margin-top: 16px;
}
.code-panel {
  max-height: 420px;
  overflow: auto;
  border: 1px solid var(--el-border-color);
  background: #0d1117;
}
.code-panel :deep(code) {
  display: block;
  padding: 14px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: var(--el-font-family-monospace);
  font-size: 12px;
  line-height: 1.6;
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
