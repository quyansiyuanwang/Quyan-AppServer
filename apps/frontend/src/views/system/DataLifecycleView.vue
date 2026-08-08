<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { ArchiveArtifactDto, DataLifecycleRunDto } from '@/client/types.gen'
import { i18ns } from '@/locales'
import { dataLifecycleService } from '@/service/dataLifecycleService'

const loading = ref(false)
const policies = ref<any[]>([])
const runs = ref<any[]>([])
const selectedDatasets = ref<string[]>([])
const schedule = ref({ enabled: true, time: '03:20', timezone: 'Asia/Shanghai' })
const scheduleSaving = ref(false)
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const archiveDrawerVisible = ref(false)
const selectedRun = ref<DataLifecycleRunDto | null>(null)
const archiveArtifacts = ref<ArchiveArtifactDto[]>([])
const archiveTotal = ref(0)
const archivePage = ref(1)
const archivePageSize = ref(20)
const archiveLoading = ref(false)
const archiveLoadFailed = ref(false)
const batchLoading = ref(false)
const previewVisible = ref(false)
const previewPolicy = ref<any | null>(null)
const previewCandidates = ref<any[]>([])
const previewTotal = ref(0)
const previewPage = ref(1)
const previewPageSize = ref(20)
const previewLoading = ref(false)
const previewExecuting = ref(false)

// Keep these aligned with DATA_LIFECYCLE_DEFAULTS on the backend.
const defaultHotRetentionDays: Record<string, number> = {
  api_logs: 90,
  business_logs: 180,
  notification_logs: 90,
  track_events: 30,
  heatmap_points: 30,
  relay_usages: 180,
  monthly_pass_usages: 180,
  server_logs: 14,
}

const datasetLabel = (dataset: string) => {
  if (dataset === 'server_logs') return i18ns.t('dataLifecycle.serverLogs')
  return dataset
}

const formatDate = (value: string | null) => (value ? new Date(value).toLocaleString() : '-')

const formatBytes = (value: string) => {
  const bytes = Number(value)
  if (!Number.isFinite(bytes) || bytes < 0) return '-'
  if (bytes < 1024) return `${bytes} B`
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 2)} ${units[index]}`
}

const runStatusLabel = (status: string) => {
  const labels = {
    running: () => i18ns.t('dataLifecycle.runStatusRunning'),
    completed: () => i18ns.t('dataLifecycle.runStatusCompleted'),
    failed: () => i18ns.t('dataLifecycle.runStatusFailed'),
  }
  return labels[status as keyof typeof labels]?.() ?? status
}

const runTypeLabel = (runType: string) => {
  const labels = {
    manual: () => i18ns.t('dataLifecycle.runTypeManual'),
    scheduled: () => i18ns.t('dataLifecycle.runTypeScheduled'),
  }
  return labels[runType as keyof typeof labels]?.() ?? runType
}

const loadArtifacts = async () => {
  if (!selectedRun.value) return
  archiveLoading.value = true
  archiveLoadFailed.value = false
  try {
    const data = await dataLifecycleService.listArtifacts(selectedRun.value.id, {
      page: archivePage.value,
      pageSize: archivePageSize.value,
    })
    archiveArtifacts.value = data?.items ?? []
    archiveTotal.value = data?.total ?? 0
  } catch {
    archiveArtifacts.value = []
    archiveTotal.value = 0
    archiveLoadFailed.value = true
  } finally {
    archiveLoading.value = false
  }
}

const openArchives = async (run: DataLifecycleRunDto) => {
  selectedRun.value = run
  archiveArtifacts.value = []
  archiveTotal.value = 0
  archivePage.value = 1
  archiveLoadFailed.value = false
  archiveDrawerVisible.value = true
  await loadArtifacts()
}

const onPolicySelectionChange = (selection: any[]) => {
  selectedDatasets.value = selection.map((policy) => policy.dataset)
}

const loadCandidates = async () => {
  if (!previewPolicy.value) return
  previewLoading.value = true
  try {
    const data = await dataLifecycleService.listCandidates(previewPolicy.value.dataset, {
      page: previewPage.value,
      pageSize: previewPageSize.value,
    })
    previewCandidates.value = data?.items ?? []
    previewTotal.value = data?.candidateCount ?? 0
  } finally {
    previewLoading.value = false
  }
}

const openRunPreview = async (policy: any) => {
  previewPolicy.value = policy
  previewCandidates.value = []
  previewTotal.value = policy.candidateCount ?? 0
  previewPage.value = 1
  previewVisible.value = true
  await loadCandidates()
}

const load = async () => {
  loading.value = true
  try {
    const [policyData, runData, scheduleData] = await Promise.all([
      dataLifecycleService.listPolicies(),
      dataLifecycleService.listRuns({ page: page.value, pageSize: pageSize.value }),
      dataLifecycleService.getSchedule(),
    ])
    policies.value = policyData
    runs.value = runData.items
    total.value = runData.total
    schedule.value = scheduleData
  } finally {
    loading.value = false
  }
}

const savePolicy = async (policy: any) => {
  await dataLifecycleService.updatePolicy(policy.dataset, {
    enabled: policy.enabled,
    hotRetentionDays: Number(policy.hotRetentionDays),
  })
  ElMessage.success(i18ns.t('dataLifecycle.saved'))
}

const saveSchedule = async () => {
  scheduleSaving.value = true
  try {
    schedule.value = await dataLifecycleService.updateSchedule({
      enabled: schedule.value.enabled,
      time: schedule.value.time,
    })
    ElMessage.success(i18ns.t('dataLifecycle.scheduleSaved'))
  } finally {
    scheduleSaving.value = false
  }
}

const resetRetention = async (policy: any) => {
  const defaultDays = defaultHotRetentionDays[policy.dataset]
  if (!defaultDays || Number(policy.hotRetentionDays) === defaultDays) return
  policy.hotRetentionDays = defaultDays
  await savePolicy(policy)
}

const runPolicy = async () => {
  if (!previewPolicy.value) return
  previewExecuting.value = true
  try {
    await dataLifecycleService.run(previewPolicy.value.dataset)
    ElMessage.success(i18ns.t('dataLifecycle.started'))
    previewVisible.value = false
    await load()
  } finally {
    previewExecuting.value = false
  }
}

const runBatch = async () => {
  if (selectedDatasets.value.length === 0) return
  const selectedPolicies = policies.value.filter((policy) =>
    selectedDatasets.value.includes(policy.dataset),
  )
  const previews = await Promise.all(
    selectedPolicies.map((policy) => dataLifecycleService.preview(policy.dataset)),
  )
  const candidateCount = previews.reduce((sum, preview) => sum + preview.candidateCount, 0)
  await ElMessageBox.confirm(
    i18ns.t('dataLifecycle.batchConfirm', {
      datasets: selectedPolicies.length,
      count: candidateCount,
    }),
    i18ns.t('dataLifecycle.batchRun'),
  )
  batchLoading.value = true
  try {
    const result = await dataLifecycleService.runBatch(selectedDatasets.value)
    const message = i18ns.t('dataLifecycle.batchResult', result)
    if (result.failedCount > 0) ElMessage.warning(message)
    else ElMessage.success(message)
    selectedDatasets.value = []
    await load()
  } finally {
    batchLoading.value = false
  }
}

const download = async (artifactId: string) => {
  const response = await dataLifecycleService.download(artifactId)
  window.open(response.url, '_blank', 'noopener,noreferrer')
}

onMounted(load)
</script>

<template>
  <section class="system-page lifecycle-page">
    <div class="page-toolbar">
      <div>
        <h2>{{ i18ns.t('dataLifecycle.title') }}</h2>
        <p>{{ i18ns.t('dataLifecycle.subtitle') }}</p>
      </div>
      <div class="toolbar-actions">
        <el-button
          type="primary"
          :loading="batchLoading"
          :disabled="selectedDatasets.length === 0"
          @click="runBatch"
        >
          {{ i18ns.t('dataLifecycle.batchRun') }}
        </el-button>
        <el-button :loading="loading" @click="load">{{ i18ns.t('refresh') }}</el-button>
      </div>
    </div>
    <section class="schedule-settings">
      <div>
        <h3>{{ i18ns.t('dataLifecycle.schedule') }}</h3>
        <p>{{ schedule.timezone }}</p>
      </div>
      <el-switch
        v-model="schedule.enabled"
        :active-text="i18ns.t('dataLifecycle.scheduleEnabled')"
      />
      <el-time-picker
        v-model="schedule.time"
        value-format="HH:mm"
        format="HH:mm"
        :disabled="!schedule.enabled"
      />
      <el-button type="primary" :loading="scheduleSaving" @click="saveSchedule">
        {{ i18ns.t('dataLifecycle.scheduleSave') }}
      </el-button>
    </section>
    <el-table
      :data="policies"
      v-loading="loading"
      row-key="dataset"
      @selection-change="onPolicySelectionChange"
    >
      <el-table-column type="selection" width="55" />
      <el-table-column prop="dataset" :label="i18ns.t('dataLifecycle.dataset')" min-width="170">
        <template #default="{ row }">{{ datasetLabel(row.dataset) }}</template>
      </el-table-column>
      <el-table-column :label="i18ns.t('dataLifecycle.enabled')" width="110"
        ><template #default="{ row }"
          ><el-switch v-model="row.enabled" @change="savePolicy(row)" /></template
      ></el-table-column>
      <el-table-column :label="i18ns.t('dataLifecycle.hotRetention')" width="270"
        ><template #default="{ row }"
          ><div class="retention-cell">
            <el-input-number
              v-model="row.hotRetentionDays"
              :min="1"
              :max="3650"
              controls-position="right"
              @change="savePolicy(row)"
            />
            <el-button @click="resetRetention(row)">
              {{ i18ns.t('dataLifecycle.reset') }}
            </el-button>
          </div></template
        ></el-table-column
      >
      <el-table-column
        prop="candidateCount"
        :label="i18ns.t('dataLifecycle.toArchive')"
        width="100"
      />
      <el-table-column
        prop="candidateCount"
        :label="i18ns.t('dataLifecycle.toDelete')"
        width="100"
      />
      <el-table-column :label="i18ns.t('dataLifecycle.actions')" width="100"
        ><template #default="{ row }"
          ><el-button type="danger" @click="openRunPreview(row)">{{
            i18ns.t('dataLifecycle.run')
          }}</el-button></template
        ></el-table-column
      >
    </el-table>
    <h3>{{ i18ns.t('dataLifecycle.runs') }}</h3>
    <el-table :data="runs" v-loading="loading" row-key="id">
      <el-table-column prop="createTime" :label="i18ns.t('dataLifecycle.time')" width="180">
        <template #default="{ row }">{{ formatDate(row.createTime) }}</template>
      </el-table-column>
      <el-table-column prop="dataset" :label="i18ns.t('dataLifecycle.dataset')">
        <template #default="{ row }">{{ datasetLabel(row.dataset) }}</template>
      </el-table-column>
      <el-table-column :label="i18ns.t('dataLifecycle.runType')" width="100">
        <template #default="{ row }">{{ runTypeLabel(row.runType) }}</template>
      </el-table-column>
      <el-table-column :label="i18ns.t('dataLifecycle.status')" width="100">
        <template #default="{ row }">{{ runStatusLabel(row.runStatus) }}</template>
      </el-table-column>
      <el-table-column
        prop="candidateCount"
        :label="i18ns.t('dataLifecycle.candidates')"
        width="90"
      />
      <el-table-column prop="archivedCount" :label="i18ns.t('dataLifecycle.archived')" />
      <el-table-column prop="deletedCount" :label="i18ns.t('dataLifecycle.deleted')" />
      <el-table-column
        prop="errorMessage"
        :label="i18ns.t('dataLifecycle.errorMessage')"
        min-width="180"
        show-overflow-tooltip
      />
      <el-table-column :label="i18ns.t('dataLifecycle.archives')" width="180" fixed="right">
        <template #default="{ row }">
          <el-button :disabled="row.artifactCount === 0" @click="openArchives(row)">
            {{ i18ns.t('dataLifecycle.viewArchives', { count: row.artifactCount }) }}
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

    <el-dialog
      v-model="previewVisible"
      :title="i18ns.t('dataLifecycle.previewTitle')"
      width="min(1080px, 96%)"
    >
      <template v-if="previewPolicy">
        <el-descriptions :column="1" border>
          <el-descriptions-item :label="i18ns.t('dataLifecycle.dataset')">
            {{ datasetLabel(previewPolicy.dataset) }}
          </el-descriptions-item>
          <el-descriptions-item :label="i18ns.t('dataLifecycle.toArchive')">
            {{ previewTotal }}
          </el-descriptions-item>
          <el-descriptions-item :label="i18ns.t('dataLifecycle.toDelete')">
            {{ previewTotal }}
          </el-descriptions-item>
        </el-descriptions>
        <el-table v-loading="previewLoading" :data="previewCandidates" class="candidate-table">
          <el-table-column
            prop="id"
            :label="i18ns.t('dataLifecycle.candidateId')"
            min-width="180"
            show-overflow-tooltip
          />
          <el-table-column :label="i18ns.t('dataLifecycle.time')" width="180">
            <template #default="{ row }">{{ formatDate(row.createTime) }}</template>
          </el-table-column>
          <el-table-column
            prop="summary"
            :label="i18ns.t('dataLifecycle.candidateSummary')"
            min-width="360"
            show-overflow-tooltip
          />
        </el-table>
        <el-pagination
          v-if="previewTotal > 0"
          v-model:current-page="previewPage"
          v-model:page-size="previewPageSize"
          :total="previewTotal"
          layout="total, sizes, prev, pager, next"
          @change="loadCandidates"
        />
      </template>
      <template #footer>
        <el-button @click="previewVisible = false">{{ i18ns.t('cancel') }}</el-button>
        <el-button type="danger" :loading="previewExecuting" @click="runPolicy">
          {{ i18ns.t('dataLifecycle.run') }}
        </el-button>
      </template>
    </el-dialog>

    <el-drawer
      v-model="archiveDrawerVisible"
      size="min(80vw, 100%)"
      :title="i18ns.t('dataLifecycle.archiveDetails')"
    >
      <template v-if="selectedRun">
        <el-descriptions :column="1" border class="run-details">
          <el-descriptions-item :label="i18ns.t('dataLifecycle.dataset')">
            {{ datasetLabel(selectedRun.dataset) }}
          </el-descriptions-item>
          <el-descriptions-item :label="i18ns.t('dataLifecycle.runType')">
            {{ runTypeLabel(selectedRun.runType) }}
          </el-descriptions-item>
          <el-descriptions-item :label="i18ns.t('dataLifecycle.status')">
            {{ runStatusLabel(selectedRun.runStatus) }}
          </el-descriptions-item>
          <el-descriptions-item :label="i18ns.t('dataLifecycle.cutoffAt')">
            {{ formatDate(selectedRun.cutoffAt) }}
          </el-descriptions-item>
          <el-descriptions-item :label="i18ns.t('dataLifecycle.candidates')">
            {{ selectedRun.candidateCount }}
          </el-descriptions-item>
          <el-descriptions-item :label="i18ns.t('dataLifecycle.archived')">
            {{ selectedRun.archivedCount }}
          </el-descriptions-item>
          <el-descriptions-item :label="i18ns.t('dataLifecycle.deleted')">
            {{ selectedRun.deletedCount }}
          </el-descriptions-item>
          <el-descriptions-item :label="i18ns.t('dataLifecycle.completedAt')">
            {{ formatDate(selectedRun.completedAt) }}
          </el-descriptions-item>
          <el-descriptions-item
            v-if="selectedRun.errorMessage"
            :label="i18ns.t('dataLifecycle.errorMessage')"
          >
            <span class="error-message">{{ selectedRun.errorMessage }}</span>
          </el-descriptions-item>
        </el-descriptions>

        <section class="artifact-section">
          <h3>{{ i18ns.t('dataLifecycle.archives') }}</h3>
          <el-alert
            v-if="archiveLoadFailed"
            type="warning"
            :title="i18ns.t('dataLifecycle.archiveLoadFailed')"
            :closable="false"
            show-icon
            ><el-button :loading="archiveLoading" @click="loadArtifacts">
              {{ i18ns.t('reload') }}
            </el-button></el-alert
          >
          <el-empty
            v-else-if="archiveTotal === 0 && !archiveLoading"
            :description="i18ns.t('dataLifecycle.noArchives')"
          />
          <el-table
            v-else
            v-loading="archiveLoading"
            :data="archiveArtifacts"
            border
            class="artifact-table"
          >
            <el-table-column
              prop="objectKey"
              :label="i18ns.t('dataLifecycle.objectKey')"
              min-width="310"
              show-overflow-tooltip
            />
            <el-table-column
              prop="sha256"
              :label="i18ns.t('dataLifecycle.checksum')"
              min-width="210"
              show-overflow-tooltip
            />
            <el-table-column
              prop="recordCount"
              :label="i18ns.t('dataLifecycle.records')"
              width="90"
            />
            <el-table-column :label="i18ns.t('dataLifecycle.size')" width="110">
              <template #default="{ row }">{{ formatBytes(row.byteSize) }}</template>
            </el-table-column>
            <el-table-column :label="i18ns.t('dataLifecycle.archiveTime')" width="180">
              <template #default="{ row }">{{ formatDate(row.createTime) }}</template>
            </el-table-column>
            <el-table-column :label="i18ns.t('dataLifecycle.expiresAt')" width="180">
              <template #default="{ row }">{{ formatDate(row.expiresAt) }}</template>
            </el-table-column>
            <el-table-column :label="i18ns.t('dataLifecycle.deletedAt')" width="180">
              <template #default="{ row }">{{ formatDate(row.deletedAt) }}</template>
            </el-table-column>
            <el-table-column :label="i18ns.t('dataLifecycle.actions')" width="240" fixed="right">
              <template #default="{ row }">
                <el-button v-if="!row.deletedAt" @click="download(row.id)">
                  {{ i18ns.t('dataLifecycle.download', { count: row.recordCount }) }}
                </el-button>
                <span v-else>{{ i18ns.t('dataLifecycle.archiveDeleted') }}</span>
              </template>
            </el-table-column>
          </el-table>
          <el-pagination
            v-if="archiveTotal > 0"
            v-model:current-page="archivePage"
            v-model:page-size="archivePageSize"
            :total="archiveTotal"
            layout="total, sizes, prev, pager, next"
            @change="loadArtifacts"
          />
        </section>
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
.page-toolbar {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
}
.toolbar-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}
.schedule-settings {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  padding: 12px 0;
  border-block: 1px solid var(--el-border-color-lighter);
}
.schedule-settings > div:first-child {
  margin-right: auto;
}
.schedule-settings h3,
.schedule-settings p {
  margin: 0;
}
.schedule-settings p {
  margin-top: 4px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.page-toolbar h2,
.page-toolbar p {
  margin: 0;
}
.page-toolbar p {
  color: var(--el-text-color-secondary);
  margin-top: 4px;
}
.retention-cell {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.retention-cell :deep(.el-input-number) {
  width: 120px;
}
.run-details :deep(.el-descriptions__content) {
  overflow-wrap: anywhere;
}
.artifact-section {
  margin-top: 20px;
}
.artifact-section h3 {
  margin: 0 0 12px;
}
.artifact-table {
  width: 100%;
}
.candidate-table {
  width: 100%;
  margin-top: 16px;
}
.error-message {
  color: var(--el-color-danger);
  overflow-wrap: anywhere;
}
</style>
