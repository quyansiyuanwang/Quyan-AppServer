<template>
  <div v-if="isDesktop">
    <el-row :gutter="16" class="summary-grid">
      <el-col
        v-for="item in summaryCards"
        :key="item.key"
        :xs="24"
        :sm="12"
        :md="8"
        :lg="8"
        :xl="4"
      >
        <el-card class="summary-card" shadow="hover" v-loading="loading">
          <div class="summary-label">{{ item.label }}</div>
          <div class="summary-value">{{ item.value }}</div>
          <div class="summary-hint">{{ item.hint }}</div>
        </el-card>
      </el-col>
    </el-row>
  </div>
  <div v-else class="mobile-summary-grid">
    <el-card
      v-for="item in summaryCards"
      :key="item.key"
      class="summary-card"
      shadow="hover"
      v-loading="loading"
    >
      <div class="summary-label">{{ item.label }}</div>
      <div class="summary-value">{{ item.value }}</div>
      <div class="summary-hint">{{ item.hint }}</div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import type { ConsumptionSummaryCard } from '../chart-options'

defineProps<{
  isDesktop: boolean
  loading: boolean
  summaryCards: ConsumptionSummaryCard[]
}>()
</script>

<style scoped>
.summary-grid {
  width: 100%;
  min-width: 0;
}

.summary-card {
  border-radius: 10px;
  min-height: 120px;
  width: 100%;
  min-width: 0;
}

.summary-label {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  margin-bottom: 12px;
}

.summary-value {
  font-size: 24px;
  font-weight: 700;
  color: var(--el-text-color-primary);
  line-height: 1.2;
}

.summary-hint {
  margin-top: 10px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.mobile-summary-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
}
</style>
