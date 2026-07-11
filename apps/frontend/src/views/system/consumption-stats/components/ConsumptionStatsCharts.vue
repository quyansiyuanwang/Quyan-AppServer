<template>
  <div v-if="isDesktop">
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
              <span class="card-title">{{ i18ns.t('ConsumptionStats.channelDistribution') }}</span>
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
  </div>

  <el-card v-else class="chart-card" shadow="never" v-loading="loading">
    <template #header>
      <div class="card-header">
        <span class="card-title">{{ i18ns.t('ConsumptionStats.dailyTrend') }}</span>
      </div>
    </template>
    <AsyncVChart class="chart mobile-chart" autoresize :option="dailyTrendOption" />
  </el-card>
</template>

<script setup lang="ts">
import { i18ns } from '@/locales'
import { AsyncVChart } from '@/utils/asyncChart'

defineProps<{
  channelPieOption: Record<string, unknown>
  dailyTrendOption: Record<string, unknown>
  isDesktop: boolean
  loading: boolean
  modelBarOption: Record<string, unknown>
  userBarOption: Record<string, unknown>
}>()
</script>

<style scoped>
.chart-grid {
  margin-bottom: 16px;
  width: 100%;
  min-width: 0;
}

.chart-card {
  border-radius: 10px;
  width: 100%;
  min-width: 0;
}

.chart-card :deep(.el-card__body) {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
}

.card-header {
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

.mobile-chart {
  height: 280px;
}
</style>
