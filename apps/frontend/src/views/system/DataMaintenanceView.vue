<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { i18ns } from '@/locales'
import { dataMaintenanceService } from '@/service/dataMaintenanceService'

const datasets = [
  'api_logs',
  'business_logs',
  'notification_logs',
  'track_events',
  'heatmap_points',
  'relay_usages',
  'monthly_pass_usages',
]

const selectedDatasets = ref([...datasets])
const optimizePreview = ref<any | null>(null)
const optimizeLoading = ref(false)
const importDataset = ref<string>('api_logs')
const selectedFile = ref<File | null>(null)
const importPreview = ref<any | null>(null)
const importLoading = ref(false)
const runs = ref<any[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const historyLoading = ref(false)
let pollTimer: ReturnType<typeof setInterval> | null = null

const allSelected = computed({
  get: () => selectedDatasets.value.length === datasets.length,
  set: (value: boolean) => {
    selectedDatasets.value = value ? [...datasets] : []
  },
})

const label = (dataset: string) =>
  dataset.replace(/_/g, ' ').replace(/\b\w/g, (value: string) => value.toUpperCase())

const formatBytes = (value: number) => {
  if (!Number.isFinite(value)) return '-'
  if (value < 1024) return `${value} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let size = value
  let index = -1
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024
    index += 1
  }
  return `${size.toFixed(2)} ${units[index]}`
}

const formatDate = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString() : '-'

const statusLabel = (status: string) =>
  i18ns.t(`dataMaintenance.${status}` as never) || status

const loadRuns = async () => {
  historyLoading.value = true
  try {
    const result = await dataMaintenanceService.listRuns({
      page: page.value,
      pageSize: pageSize.value,
    })
    runs.value = result?.items ?? []
    total.value = result?.total ?? 0
  } catch {
    ElMessage.error(i18ns.t('dataMaintenance.loadFailed'))
  } finally {
    historyLoading.value = false
  }
}

const previewOptimize = async () => {
  if (selectedDatasets.value.length === 0) return
  optimizeLoading.value = true
  try {
    optimizePreview.value = await dataMaintenanceService.optimizePreview(
      selectedDatasets.value,
    )
  } catch {
    ElMessage.error(i18ns.t('dataMaintenance.executeFailed'))
  } finally {
    optimizeLoading.value = false
  }
}

const runOptimize = async () => {
  if (!optimizePreview.value) {
    ElMessage.warning(i18ns.t('dataMaintenance.previewRequired'))
    return
  }
  try {
    await ElMessageBox.prompt(
      i18ns.t('dataMaintenance.optimizePhrase'),
      i18ns.t('dataMaintenance.confirmTitle'),
      {
        inputPattern: /^OPTIMIZE$/,
        inputErrorMessage: 'OPTIMIZE',
        confirmButtonText: i18ns.t('dataMaintenance.optimizeRun'),
        cancelButtonText: i18ns.t('common.cancel'),
      },
    )
    await dataMaintenanceService.optimize(selectedDatasets.value)
    ElMessage.success(i18ns.t('dataMaintenance.success'))
    await loadRuns()
  } catch {
    // cancel and validation errors are intentionally silent
  }
}

const onFileChange = (event: Event) => {
  const input = event.target as HTMLInputElement
  selectedFile.value = input.files?.[0] ?? null
  importPreview.value = null
}

const previewImport = async () => {
  const file = selectedFile.value
  if (!file) {
    ElMessage.warning(i18ns.t('dataMaintenance.noFile'))
    return
  }
  importLoading.value = true
  try {
    importPreview.value = await dataMaintenanceService.importPreview(
      importDataset.value,
      file,
    )
  } catch {
    ElMessage.error(i18ns.t('dataMaintenance.executeFailed'))
  } finally {
    importLoading.value = false
  }
}

const runImport = async () => {
  const file = selectedFile.value
  if (!file || !importPreview.value?.executable) {
    ElMessage.warning(i18ns.t('dataMaintenance.previewRequired'))
    return
  }
  try {
    await ElMessageBox.prompt(
      i18ns.t('dataMaintenance.importPhrase'),
      i18ns.t('dataMaintenance.confirmTitle'),
      {
        inputPattern: /^IMPORT$/,
        inputErrorMessage: 'IMPORT',
        confirmButtonText: i18ns.t('dataMaintenance.runImport'),
        cancelButtonText: i18ns.t('common.cancel'),
      },
    )
    await dataMaintenanceService.createImport(importDataset.value, file)
    ElMessage.success(i18ns.t('dataMaintenance.success'))
    await loadRuns()
  } catch {
    // cancel and validation errors are intentionally silent
  }
}

const handlePageChange = (value: number) => {
  page.value = value
  void loadRuns()
}

const handlePageSizeChange = (value: number) => {
  pageSize.value = value
  page.value = 1
  void loadRuns()
}

onMounted(() => {
  void loadRuns()
  pollTimer = setInterval(() => {
    if (runs.value.some((run) => run.runStatus === 'queued' || run.runStatus === 'running'))
      void loadRuns()
  }, 4000)
})

onBeforeUnmount(() => {
  if (pollTimer) clearInterval(pollTimer)
})
</script>

<template>
  <div class="maintenance-page">
    <div class="page-heading">
      <div>
        <h1>{{ i18ns.t('dataMaintenance.title') }}</h1>
        <p>{{ i18ns.t('dataMaintenance.subtitle') }}</p>
      </div>
      <el-alert :title="i18ns.t('dataMaintenance.warning')" type="warning" :closable="false" />
    </div>

    <section class="maintenance-section">
      <div class="section-heading">
        <div>
          <h2>{{ i18ns.t('dataMaintenance.optimize') }}</h2>
          <p>{{ i18ns.t('dataMaintenance.datasets') }}</p>
        </div>
        <el-checkbox v-model="allSelected">{{ i18ns.t('dataMaintenance.selectAll') }}</el-checkbox>
      </div>
      <el-checkbox-group v-model="selectedDatasets" class="dataset-grid">
        <el-checkbox v-for="dataset in datasets" :key="dataset" :label="dataset">
          {{ label(dataset) }}
        </el-checkbox>
      </el-checkbox-group>
      <div class="actions">
        <el-button class="maintenance-button" :loading="optimizeLoading" @click="previewOptimize">
          {{ i18ns.t('dataMaintenance.optimizePreview') }}
        </el-button>
        <el-button
          class="maintenance-button danger"
          :disabled="!optimizePreview"
          @click="runOptimize"
        >
          {{ i18ns.t('dataMaintenance.optimizeRun') }}
        </el-button>
      </div>
      <el-table v-if="optimizePreview" :data="optimizePreview.items" class="preview-table" border>
        <el-table-column prop="tableName" :label="i18ns.t('dataMaintenance.dataset')" />
        <el-table-column prop="rowCount" :label="i18ns.t('dataMaintenance.rows')" />
        <el-table-column :label="i18ns.t('dataMaintenance.bytes')">
          <template #default="{ row }">{{ formatBytes(row.dataBytes + row.indexBytes) }}</template>
        </el-table-column>
      </el-table>
    </section>

    <section class="maintenance-section">
      <div class="section-heading">
        <div>
          <h2>{{ i18ns.t('dataMaintenance.import') }}</h2>
          <p>{{ i18ns.t('dataMaintenance.chooseFile') }}</p>
        </div>
      </div>
      <div class="import-controls">
        <el-select v-model="importDataset" :aria-label="i18ns.t('dataMaintenance.dataset')">
          <el-option v-for="dataset in datasets" :key="dataset" :label="label(dataset)" :value="dataset" />
        </el-select>
        <input type="file" accept=".ndjson.gz,application/gzip" @change="onFileChange" />
      </div>
      <div class="actions">
        <el-button class="maintenance-button" :loading="importLoading" @click="previewImport">
          {{ i18ns.t('dataMaintenance.previewImport') }}
        </el-button>
        <el-button
          class="maintenance-button danger"
          :disabled="!importPreview?.executable"
          @click="runImport"
        >
          {{ i18ns.t('dataMaintenance.runImport') }}
        </el-button>
      </div>
      <el-descriptions v-if="importPreview" :column="2" border>
        <el-descriptions-item :label="i18ns.t('dataMaintenance.total')">{{ importPreview.totalCount }}</el-descriptions-item>
        <el-descriptions-item :label="i18ns.t('dataMaintenance.newRecords')">{{ importPreview.newCount }}</el-descriptions-item>
        <el-descriptions-item :label="i18ns.t('dataMaintenance.duplicates')">{{ importPreview.duplicateCount }}</el-descriptions-item>
        <el-descriptions-item :label="i18ns.t('dataMaintenance.invalid')">{{ importPreview.invalidCount }}</el-descriptions-item>
        <el-descriptions-item :label="i18ns.t('dataMaintenance.missingForeignKeys')">{{ importPreview.missingForeignKeyCount }}</el-descriptions-item>
      </el-descriptions>
      <el-alert v-if="importPreview?.errors?.length" type="error" :closable="false" class="import-errors">
        {{ importPreview.errors.join('; ') }}
      </el-alert>
    </section>

    <section class="maintenance-section">
      <div class="section-heading"><h2>{{ i18ns.t('dataMaintenance.history') }}</h2></div>
      <el-table :data="runs" v-loading="historyLoading" border>
        <el-table-column prop="operation" :label="i18ns.t('dataMaintenance.operation')" />
        <el-table-column prop="dataset" :label="i18ns.t('dataMaintenance.dataset')" />
        <el-table-column :label="i18ns.t('dataMaintenance.datasets')">
          <template #default="{ row }">
            {{ Array.isArray(row.tableNames) ? row.tableNames.join(', ') : '-' }}
          </template>
        </el-table-column>
        <el-table-column :label="i18ns.t('dataMaintenance.status')">
          <template #default="{ row }">{{ statusLabel(row.runStatus) }}</template>
        </el-table-column>
        <el-table-column :label="i18ns.t('dataMaintenance.createdAt')">
          <template #default="{ row }">{{ formatDate(row.createTime) }}</template>
        </el-table-column>
        <el-table-column :label="i18ns.t('dataMaintenance.completedAt')">
          <template #default="{ row }">{{ formatDate(row.completedAt) }}</template>
        </el-table-column>
        <el-table-column :label="i18ns.t('dataMaintenance.result')">
          <template #default="{ row }">
            {{ i18ns.t('dataMaintenance.resultSummary', {
              total: row.totalCount,
              inserted: row.insertedCount,
              skipped: row.skippedCount,
              failed: row.failedCount,
            }) }}
          </template>
        </el-table-column>
        <el-table-column prop="errorMessage" :label="i18ns.t('dataLifecycle.errorMessage')" />
      </el-table>
      <el-empty v-if="!historyLoading && runs.length === 0" :description="i18ns.t('dataMaintenance.noRecords')" />
      <el-pagination
        v-if="total > 0"
        class="pagination"
        background
        layout="total, sizes, prev, pager, next"
        :total="total"
        :current-page="page"
        :page-size="pageSize"
        :page-sizes="[20, 50, 100]"
        @current-change="handlePageChange"
        @size-change="handlePageSizeChange"
      />
    </section>
  </div>
</template>

<style scoped>
.maintenance-page { padding: 24px; display: grid; gap: 20px; }
.page-heading, .section-heading { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
.page-heading h1, .section-heading h2 { margin: 0; }
.page-heading p, .section-heading p { margin: 8px 0 0; color: var(--el-text-color-secondary); }
.page-heading .el-alert { max-width: 560px; }
.maintenance-section { background: var(--el-bg-color); border: 1px solid var(--el-border-color-light); padding: 20px; }
.dataset-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 8px 16px; margin: 18px 0; }
.actions { display: flex; flex-wrap: wrap; gap: 10px; margin: 16px 0; }
.maintenance-button { background: #2563eb; border-color: #2563eb; color: #fff; }
.maintenance-button.danger { background: #b42318; border-color: #b42318; }
.maintenance-button:disabled { color: #9ca3af; background: #e5e7eb; border-color: #d1d5db; }
.preview-table, .import-errors { margin-top: 16px; }
.import-controls { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-top: 16px; }
.import-controls input[type='file'] { max-width: 100%; }
.pagination { justify-content: flex-end; margin-top: 16px; }
@media (max-width: 680px) { .page-heading, .section-heading { flex-direction: column; } .page-heading .el-alert { max-width: none; width: 100%; } }
</style>
