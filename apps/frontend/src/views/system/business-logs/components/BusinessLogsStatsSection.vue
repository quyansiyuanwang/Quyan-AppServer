<template>
  <div class="stats-section" v-loading="loading">
    <el-row :gutter="16" class="summary-grid">
      <el-col v-for="item in summaryCards" :key="item.key" :xs="24" :sm="12" :lg="6">
        <el-card class="summary-card" shadow="hover">
          <div class="summary-label">{{ item.label }}</div>
          <div class="summary-value">{{ item.value }}</div>
          <div class="summary-hint">{{ item.hint }}</div>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="16" class="chart-grid">
      <el-col :xs="24" :lg="14">
        <el-card class="chart-card" shadow="never">
          <template #header>
            <div class="card-header">
              <span class="card-title">{{ i18ns.t('BusinessLogs.dailyTrend') }}</span>
            </div>
          </template>
          <AsyncVChart class="chart" autoresize :option="dailyTrendOption" />
        </el-card>
      </el-col>
      <el-col :xs="24" :lg="10">
        <el-card class="chart-card" shadow="never">
          <template #header>
            <div class="card-header">
              <span class="card-title">{{
                i18ns.t('BusinessLogs.operationTypeDistribution')
              }}</span>
            </div>
          </template>
          <AsyncVChart class="chart" autoresize :option="typePieOption" />
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="16" class="chart-grid">
      <el-col :xs="24" :lg="12">
        <el-card class="chart-card" shadow="never">
          <template #header>
            <div class="card-header">
              <span class="card-title">{{ i18ns.t('BusinessLogs.categoryDistribution') }}</span>
            </div>
          </template>
          <AsyncVChart class="chart" autoresize :option="categoryBarOption" />
        </el-card>
      </el-col>
      <el-col :xs="24" :lg="12">
        <el-card class="chart-card" shadow="never">
          <template #header>
            <div class="card-header">
              <span class="card-title">{{ i18ns.t('BusinessLogs.statusDistribution') }}</span>
            </div>
          </template>
          <AsyncVChart class="chart" autoresize :option="statusPieOption" />
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { AsyncVChart } from '@/utils/asyncChart'
import { i18ns } from '@/locales'
import type { BusinessLogSummaryCard } from '../types'

defineProps<{
  loading: boolean
  summaryCards: BusinessLogSummaryCard[]
  dailyTrendOption: Record<string, unknown>
  typePieOption: Record<string, unknown>
  categoryBarOption: Record<string, unknown>
  statusPieOption: Record<string, unknown>
}>()
</script>

<style scoped>
.stats-section {
  margin-bottom: 20px;
}

.summary-grid,
.chart-grid {
  margin-bottom: 16px;
}

.summary-card,
.chart-card {
  border-radius: 10px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.card-title {
  font-size: 18px;
  font-weight: 600;
}

.summary-label {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.summary-value {
  margin-top: 8px;
  font-size: 24px;
  font-weight: 700;
}

.summary-hint {
  margin-top: 6px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.chart {
  height: 320px;
}
</style>
