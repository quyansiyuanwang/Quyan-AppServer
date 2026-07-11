<template>
  <div v-if="isDesktop" class="desktop-page page-shell oj-usage-page">
    <el-card class="page-card">
      <template #header>
        <div class="oj-usage-page__header">
          <span class="oj-usage-page__title">{{ i18ns.t('ojSubmitter.usageStatistics') }}</span>
          <div class="oj-usage-page__filters">
            <el-date-picker
              v-model="dateRange"
              type="daterange"
              :start-placeholder="i18ns.t('ojSubmitter.startDate')"
              :end-placeholder="i18ns.t('ojSubmitter.endDate')"
              class="oj-usage-page__date-range"
              @change="loadStats"
            />
            <el-button @click="resetFilter">{{ i18ns.t('reset') }}</el-button>
          </div>
        </div>
      </template>

      <!-- Summary Stats -->
      <el-row :gutter="20" class="stats-row oj-usage-page__stats-row">
        <el-col :xs="24" :sm="12" :span="6">
          <el-statistic :title="i18ns.t('ojSubmitter.requestCount')" :value="stats.requestCount" />
        </el-col>
        <el-col :xs="24" :sm="12" :span="6">
          <el-statistic :title="i18ns.t('ojSubmitter.totalTokens')" :value="stats.totalTokens" />
        </el-col>
        <el-col :xs="24" :sm="12" :span="6">
          <el-statistic
            :title="i18ns.t('ojSubmitter.totalCost')"
            :value="stats.totalCost"
            :precision="4"
            :suffix="` ${i18ns.t('balance.yuan')}`"
          />
        </el-col>
        <el-col :xs="24" :sm="12" :span="6">
          <el-statistic
            :title="i18ns.t('ojSubmitter.avgTokensPerRequest')"
            :value="stats.avgTokensPerRequest"
          />
        </el-col>
      </el-row>

      <!-- Usage Table -->
      <div class="oj-usage-page__table-wrap">
        <el-table
          :data="usages"
          class="oj-usage-page__table"
          style="width: 100%"
          v-loading="loading"
        >
          <el-table-column :label="i18ns.t('ojSubmitter.createTime')" width="160">
            <template #default="{ row }">
              {{ new Date(row.createTime).toLocaleString() }}
            </template>
          </el-table-column>
          <el-table-column prop="model" :label="i18ns.t('ojSubmitter.model')" width="180" />
          <el-table-column
            prop="question"
            :label="i18ns.t('ojSubmitter.question')"
            show-overflow-tooltip
            class-name="hide-on-mobile"
          />
          <el-table-column
            prop="inputTokens"
            :label="i18ns.t('ojSubmitter.inputTokens')"
            width="100"
            class-name="hide-on-mobile"
          />
          <el-table-column
            prop="outputTokens"
            :label="i18ns.t('ojSubmitter.outputTokens')"
            width="110"
            class-name="hide-on-mobile"
          />
          <el-table-column
            prop="totalTokens"
            :label="i18ns.t('ojSubmitter.totalTokens')"
            width="100"
          />
          <el-table-column :label="i18ns.t('ojSubmitter.cost')" width="120">
            <template #default="{ row }">
              {{ Number(row.cost).toFixed(4) }} {{ i18ns.t('balance.yuan') }}
            </template>
          </el-table-column>
          <el-table-column :label="i18ns.t('actions')" width="140" fixed="right">
            <template #default="{ row }">
              <el-button size="small" @click="viewDetail(row)">{{
                i18ns.t('button.viewDetails')
              }}</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <!-- Pagination -->
      <div class="oj-usage-page__pagination">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :total="stats.total"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next"
          @change="loadStats"
        />
      </div>

      <!-- Detail Dialog -->
      <el-dialog
        v-model="showDetailDialog"
        :title="i18ns.t('ojSubmitter.usageStatistics')"
        width="680px"
      >
        <template v-if="selectedRecord">
          <el-descriptions :column="2" border>
            <el-descriptions-item :label="i18ns.t('ojSubmitter.model')">{{
              selectedRecord.model
            }}</el-descriptions-item>
            <el-descriptions-item :label="i18ns.t('ojSubmitter.createTime')">{{
              new Date(selectedRecord.createTime).toLocaleString()
            }}</el-descriptions-item>
            <el-descriptions-item :label="i18ns.t('ojSubmitter.inputTokens')">{{
              selectedRecord.inputTokens
            }}</el-descriptions-item>
            <el-descriptions-item :label="i18ns.t('ojSubmitter.outputTokens')">{{
              selectedRecord.outputTokens
            }}</el-descriptions-item>
            <el-descriptions-item :label="i18ns.t('ojSubmitter.cost')" :span="2"
              >{{ Number(selectedRecord.cost).toFixed(4) }}
              {{ i18ns.t('balance.yuan') }}</el-descriptions-item
            >
          </el-descriptions>
          <el-divider>{{ i18ns.t('ojSubmitter.question') }}</el-divider>
          <el-input :value="selectedRecord.question" type="textarea" :rows="3" readonly />
          <el-divider>{{ i18ns.t('ojSubmitter.answer') }}</el-divider>
          <el-input :value="selectedRecord.answer" type="textarea" :rows="6" readonly />
        </template>
      </el-dialog>
    </el-card>
  </div>
  <div v-else class="mobile-page">
    <div class="oj-usage-mobile">
      <el-card class="mobile-card">
        <template #header>
          <div class="card-header toolbar-row">
            <span>{{ i18ns.t('ojSubmitter.usageStatistics') }}</span>
            <div class="filters">
              <el-date-picker
                v-model="startTime"
                type="date"
                :placeholder="i18ns.t('ojSubmitter.startDate')"
                style="width: 100%"
                @change="loadStats"
              />
              <el-date-picker
                v-model="endTime"
                type="date"
                :placeholder="i18ns.t('ojSubmitter.endDate')"
                style="width: 100%"
                @change="loadStats"
              />
              <el-button @click="resetFilter">{{ i18ns.t('reset') }}</el-button>
            </div>
          </div>
        </template>

        <div class="stats-grid">
          <el-statistic :title="i18ns.t('ojSubmitter.requestCount')" :value="stats.requestCount" />
          <el-statistic :title="i18ns.t('ojSubmitter.totalTokens')" :value="stats.totalTokens" />
          <el-statistic
            :title="i18ns.t('ojSubmitter.totalCost')"
            :value="stats.totalCost.toFixed(4)"
            :suffix="` ${i18ns.t('balance.yuan')}`"
          />
          <el-statistic
            :title="i18ns.t('ojSubmitter.avgTokensPerRequest')"
            :value="stats.avgTokensPerRequest"
          />
        </div>

        <el-skeleton :loading="loading" :rows="5" animated>
          <div v-if="usages.length" class="usage-list">
            <el-card
              v-for="row in usages"
              :key="row.id"
              class="usage-item mobile-card"
              shadow="never"
            >
              <div class="item-header">
                <div class="model">{{ row.model }}</div>
                <div class="cost">
                  {{ Number(row.cost).toFixed(4) }} {{ i18ns.t('balance.yuan') }}
                </div>
              </div>
              <div class="meta">
                <div>
                  {{ i18ns.t('ojSubmitter.createTime') }}:
                  {{ new Date(row.createTime).toLocaleString() }}
                </div>
                <div>{{ i18ns.t('ojSubmitter.inputTokens') }}: {{ row.inputTokens }}</div>
                <div>{{ i18ns.t('ojSubmitter.outputTokens') }}: {{ row.outputTokens }}</div>
                <div>{{ i18ns.t('ojSubmitter.totalTokens') }}: {{ row.totalTokens }}</div>
                <div>{{ i18ns.t('ojSubmitter.question') }}: {{ row.question || '-' }}</div>
              </div>
              <el-button plain size="small" class="detail-btn" @click="viewDetail(row)">{{
                i18ns.t('button.viewDetails')
              }}</el-button>
            </el-card>
          </div>
          <el-empty v-else />
        </el-skeleton>

        <div class="pager-wrap">
          <el-pagination
            v-model:current-page="page"
            v-model:page-size="pageSize"
            :total="stats.total"
            :page-sizes="[10, 20, 50]"
            layout="total, prev, pager, next"
            @change="loadStats"
          />
        </div>
      </el-card>

      <el-dialog
        v-model="showDetailDialog"
        :title="i18ns.t('ojSubmitter.usageStatistics')"
        width="96%"
      >
        <template v-if="selectedRecord">
          <el-descriptions :column="1" border>
            <el-descriptions-item :label="i18ns.t('ojSubmitter.model')">{{
              selectedRecord.model
            }}</el-descriptions-item>
            <el-descriptions-item :label="i18ns.t('ojSubmitter.createTime')">{{
              new Date(selectedRecord.createTime).toLocaleString()
            }}</el-descriptions-item>
            <el-descriptions-item :label="i18ns.t('ojSubmitter.inputTokens')">{{
              selectedRecord.inputTokens
            }}</el-descriptions-item>
            <el-descriptions-item :label="i18ns.t('ojSubmitter.outputTokens')">{{
              selectedRecord.outputTokens
            }}</el-descriptions-item>
            <el-descriptions-item :label="i18ns.t('ojSubmitter.cost')"
              >{{ Number(selectedRecord.cost).toFixed(4) }}
              {{ i18ns.t('balance.yuan') }}</el-descriptions-item
            >
          </el-descriptions>
          <el-divider>{{ i18ns.t('ojSubmitter.question') }}</el-divider>
          <el-input :value="selectedRecord.question" type="textarea" :rows="3" readonly />
          <el-divider>{{ i18ns.t('ojSubmitter.answer') }}</el-divider>
          <el-input :value="selectedRecord.answer" type="textarea" :rows="6" readonly />
        </template>
      </el-dialog>
    </div>
  </div>
</template>

<script setup lang="ts">
import { usePageDevice } from '@/composables/usePageDevice'
import { ref, onMounted } from 'vue'
import { i18ns } from '@/locales'
import { ElMessage } from 'element-plus'
import { OJUsageService } from '@/service/ojUsageService'
import type { OjUsageRecordDto } from '@/client/types.gen'

const ojUsageService = OJUsageService.getInstance()
const usages = ref<OjUsageRecordDto[]>([])
const loading = ref(false)
const page = ref(1)
const pageSize = ref(20)
const dateRange = ref<[Date, Date] | null>(null)
const startTime = ref<Date | null>(null)
const endTime = ref<Date | null>(null)
const showDetailDialog = ref(false)
const selectedRecord = ref<OjUsageRecordDto | null>(null)

const stats = ref({
  total: 0,
  requestCount: 0,
  totalTokens: 0,
  totalCost: 0,
  avgTokensPerRequest: 0,
  avgCostPerRequest: 0,
})

const loadStats = async () => {
  loading.value = true
  try {
    const params: Record<string, any> = {
      page: page.value,
      pageSize: pageSize.value,
    }
    if (dateRange.value) {
      params.startTime = dateRange.value[0].toISOString()
      params.endTime = dateRange.value[1].toISOString()
    } else {
      if (startTime.value) {
        const s = new Date(startTime.value)
        s.setHours(0, 0, 0, 0)
        params.startTime = s.toISOString()
      }
      if (endTime.value) {
        const e = new Date(endTime.value)
        e.setHours(23, 59, 59, 999)
        params.endTime = e.toISOString()
      }
    }
    const result = (await ojUsageService.getUsageStats(params)) as unknown as any
    usages.value = result.usages || []
    stats.value = {
      total: result.total || 0,
      requestCount: result.requestCount || 0,
      totalTokens: result.totalTokens || 0,
      totalCost: result.totalCost || 0,
      avgTokensPerRequest: result.avgTokensPerRequest || 0,
      avgCostPerRequest: result.avgCostPerRequest || 0,
    }
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('ojSubmitter.loadFailed'))
  } finally {
    loading.value = false
  }
}

const resetFilter = () => {
  dateRange.value = null
  startTime.value = null
  endTime.value = null
  page.value = 1
  loadStats()
}

const viewDetail = (row: OjUsageRecordDto) => {
  selectedRecord.value = row
  showDetailDialog.value = true
}

onMounted(() => {
  loadStats()
})

const { isDesktop } = usePageDevice()
</script>

<style scoped>
.oj-usage-page {
  width: 100%;
  min-width: 0;
}

.oj-usage-page :deep(.el-card__body) {
  width: 100%;
  min-width: 0;
}

.oj-usage-page__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  width: 100%;
  min-width: 0;
}

.oj-usage-page__title {
  min-width: 0;
  font-size: 16px;
  font-weight: 600;
}

.oj-usage-page__filters {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  min-width: 0;
}

.oj-usage-page__date-range {
  width: 280px;
  max-width: 100%;
}

.oj-usage-page__stats-row {
  margin-bottom: 24px;
}

.oj-usage-page__stats-row :deep(.el-col) {
  min-width: 0;
}

.oj-usage-page__table-wrap {
  width: 100%;
  min-width: 0;
  overflow-x: auto;
}

.oj-usage-page__table-wrap :deep(.oj-usage-page__table) {
  min-width: 1180px;
}

.oj-usage-page__table-wrap :deep(.el-table__header),
.oj-usage-page__table-wrap :deep(.el-table__body) {
  width: 100% !important;
  table-layout: fixed;
}

.oj-usage-page__table-wrap :deep(.el-table__inner-wrapper),
.oj-usage-page__table-wrap :deep(.el-table__body-wrapper) {
  width: 100%;
}

.oj-usage-page :deep(.el-table .cell) {
  word-break: break-word;
}

.oj-usage-page__pagination {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}

@media (max-width: 1200px) {
  .oj-usage-page__header {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .oj-usage-page__filters {
    width: 100%;
    justify-content: flex-start;
  }
}

@media (max-width: 768px) {
  :deep(.hide-on-mobile) {
    display: none;
  }
}
@media (max-width: 480px) {
  .el-card__header > div {
    flex-direction: column;
    align-items: flex-start !important;
    gap: 12px;
  }
  .el-card__header > div > div {
    width: 100%;
    flex-direction: column;
    align-items: flex-start !important;
  }
  .el-card__header .el-date-editor {
    width: 100% !important;
    max-width: 280px;
  }
  .stats-row .el-col {
    margin-bottom: 12px;
  }
  .stats-row .el-col:last-child {
    margin-bottom: 0;
  }
}
</style>

<style scoped>
.oj-usage-mobile {
  padding: 8px 6px 16px;
}

.oj-usage-mobile .card-header {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.oj-usage-mobile .filters {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
}

.oj-usage-mobile .stats-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
  margin-bottom: 12px;
}

.oj-usage-mobile .usage-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.oj-usage-mobile .usage-item {
  border: 1px solid var(--el-border-color-lighter);
}

.oj-usage-mobile .item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.oj-usage-mobile .model {
  font-weight: 600;
  word-break: break-word;
}

.oj-usage-mobile .cost {
  color: var(--el-color-danger);
  font-weight: 700;
}

.oj-usage-mobile .meta {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.oj-usage-mobile .detail-btn {
  margin-top: 10px;
  width: 100%;
  min-height: 34px;
}

.oj-usage-mobile .pager-wrap {
  margin-top: 12px;
  display: flex;
  justify-content: center;
}

.oj-usage-mobile :deep(.el-dialog) {
  width: 96% !important;
  max-width: 96% !important;
  margin-top: 3vh !important;
}

.oj-usage-mobile :deep(.el-dialog__body) {
  max-height: 72vh;
  overflow: auto;
}
</style>
