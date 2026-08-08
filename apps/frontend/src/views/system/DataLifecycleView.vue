<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { i18ns } from '@/locales'
import { dataLifecycleService } from '@/service/dataLifecycleService'

const loading = ref(false)
const policies = ref<any[]>([])
const runs = ref<any[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)

// Keep these aligned with DATA_LIFECYCLE_DEFAULTS on the backend.
const defaultHotRetentionDays: Record<string, number> = {
  api_logs: 90,
  business_logs: 180,
  notification_logs: 90,
  track_events: 30,
  heatmap_points: 30,
  relay_usages: 180,
  monthly_pass_usages: 180,
}

const load = async () => {
  loading.value = true
  try {
    const [policyData, runData] = await Promise.all([
      dataLifecycleService.listPolicies(),
      dataLifecycleService.listRuns({ page: page.value, pageSize: pageSize.value }),
    ])
    policies.value = policyData
    runs.value = runData.items
    total.value = runData.total
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

const resetRetention = async (policy: any) => {
  const defaultDays = defaultHotRetentionDays[policy.dataset]
  if (!defaultDays || Number(policy.hotRetentionDays) === defaultDays) return
  policy.hotRetentionDays = defaultDays
  await savePolicy(policy)
}

const runPolicy = async (policy: any) => {
  const preview = await dataLifecycleService.preview(policy.dataset)
  await ElMessageBox.confirm(
    i18ns.t('dataLifecycle.confirmRun', { count: preview.candidateCount }),
    i18ns.t('dataLifecycle.run'),
  )
  await dataLifecycleService.run(policy.dataset)
  ElMessage.success(i18ns.t('dataLifecycle.started'))
  await load()
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
      <el-button :loading="loading" @click="load">{{ i18ns.t('refresh') }}</el-button>
    </div>
    <el-table :data="policies" v-loading="loading" row-key="dataset">
      <el-table-column prop="dataset" :label="i18ns.t('dataLifecycle.dataset')" min-width="170" />
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
            <el-button text @click="resetRetention(row)">
              {{ i18ns.t('dataLifecycle.reset') }}
            </el-button>
          </div></template
        ></el-table-column
      >
      <el-table-column :label="i18ns.t('dataLifecycle.actions')" width="100"
        ><template #default="{ row }"
          ><el-button text type="danger" @click="runPolicy(row)">{{
            i18ns.t('dataLifecycle.run')
          }}</el-button></template
        ></el-table-column
      >
    </el-table>
    <h3>{{ i18ns.t('dataLifecycle.runs') }}</h3>
    <el-table :data="runs" v-loading="loading" row-key="id">
      <el-table-column prop="createTime" :label="i18ns.t('dataLifecycle.time')" width="180"
        ><template #default="{ row }">{{
          new Date(row.createTime).toLocaleString()
        }}</template></el-table-column
      >
      <el-table-column prop="dataset" :label="i18ns.t('dataLifecycle.dataset')" />
      <el-table-column prop="runStatus" :label="i18ns.t('dataLifecycle.status')" />
      <el-table-column prop="archivedCount" :label="i18ns.t('dataLifecycle.archived')" />
      <el-table-column prop="deletedCount" :label="i18ns.t('dataLifecycle.deleted')" />
      <el-table-column :label="i18ns.t('dataLifecycle.archives')" min-width="150"
        ><template #default="{ row }"
          ><el-button
            v-for="artifact in row.artifacts"
            :key="artifact.id"
            text
            @click="download(artifact.id)"
            >{{ i18ns.t('dataLifecycle.download', { count: artifact.recordCount }) }}</el-button
          ></template
        ></el-table-column
      >
    </el-table>
    <el-pagination
      v-model:current-page="page"
      v-model:page-size="pageSize"
      :total="total"
      layout="total, sizes, prev, pager, next"
      @change="load"
    />
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
</style>
