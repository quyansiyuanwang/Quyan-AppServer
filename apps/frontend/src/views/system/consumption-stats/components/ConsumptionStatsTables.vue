<template>
  <div v-if="isDesktop">
    <el-card class="table-card" shadow="never" v-loading="loading">
      <template #header>
        <div class="card-header table-toolbar">
          <span class="card-title">{{ i18ns.t('ConsumptionStats.channelTable') }}</span>
          <el-tag type="info">{{ rangeText }}</el-tag>
        </div>
      </template>
      <el-table :data="stats.byChannel" size="small">
        <el-table-column
          prop="label"
          :label="i18ns.t('ConsumptionStats.channel')"
          min-width="180"
        />
        <el-table-column
          prop="totalSpend"
          :label="i18ns.t('ConsumptionStats.totalSpend')"
          min-width="140"
        >
          <template #default="{ row }">{{ formatCurrency(row.totalSpend) }}</template>
        </el-table-column>
        <el-table-column
          prop="chargedSpend"
          :label="i18ns.t('ConsumptionStats.chargedSpend')"
          min-width="140"
        >
          <template #default="{ row }">{{ formatCurrency(row.chargedSpend) }}</template>
        </el-table-column>
        <el-table-column
          prop="coveredSpend"
          :label="i18ns.t('ConsumptionStats.coveredSpend')"
          min-width="140"
        >
          <template #default="{ row }">{{ formatCurrency(row.coveredSpend) }}</template>
        </el-table-column>
        <el-table-column
          prop="totalRequests"
          :label="i18ns.t('ConsumptionStats.requests')"
          min-width="110"
        />
        <el-table-column
          prop="totalTokens"
          :label="i18ns.t('ConsumptionStats.tokens')"
          min-width="130"
        />
        <el-table-column prop="share" :label="i18ns.t('ConsumptionStats.share')" min-width="110">
          <template #default="{ row }">{{ formatPercent(row.share) }}</template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-row :gutter="16" class="table-grid">
      <el-col :xs="24" :xl="12">
        <el-card class="table-card" shadow="never" v-loading="loading">
          <template #header>
            <div class="card-header">
              <span class="card-title">{{ i18ns.t('ConsumptionStats.modelTable') }}</span>
            </div>
          </template>
          <el-table :data="stats.byModel" size="small">
            <el-table-column
              prop="label"
              :label="i18ns.t('ConsumptionStats.model')"
              min-width="200"
            />
            <el-table-column
              prop="totalSpend"
              :label="i18ns.t('ConsumptionStats.totalSpend')"
              min-width="130"
            >
              <template #default="{ row }">{{ formatCurrency(row.totalSpend) }}</template>
            </el-table-column>
            <el-table-column
              prop="totalRequests"
              :label="i18ns.t('ConsumptionStats.requests')"
              min-width="100"
            />
            <el-table-column
              prop="totalTokens"
              :label="i18ns.t('ConsumptionStats.tokens')"
              min-width="120"
            />
          </el-table>
        </el-card>
      </el-col>
      <el-col :xs="24" :xl="12">
        <el-card class="table-card" shadow="never" v-loading="loading">
          <template #header>
            <div class="card-header">
              <span class="card-title">{{ i18ns.t('ConsumptionStats.userTable') }}</span>
            </div>
          </template>
          <el-table :data="stats.byUser" size="small">
            <el-table-column
              prop="label"
              :label="i18ns.t('ConsumptionStats.user')"
              min-width="180"
            />
            <el-table-column
              prop="totalSpend"
              :label="i18ns.t('ConsumptionStats.totalSpend')"
              min-width="130"
            >
              <template #default="{ row }">{{ formatCurrency(row.totalSpend) }}</template>
            </el-table-column>
            <el-table-column
              prop="totalRequests"
              :label="i18ns.t('ConsumptionStats.requests')"
              min-width="100"
            />
            <el-table-column
              prop="totalTokens"
              :label="i18ns.t('ConsumptionStats.tokens')"
              min-width="120"
            />
          </el-table>
        </el-card>
      </el-col>
    </el-row>
  </div>

  <el-collapse v-else class="mobile-collapse">
    <el-collapse-item :title="i18ns.t('ConsumptionStats.channelTable')" name="channel">
      <el-table :data="stats.byChannel" size="small">
        <el-table-column
          prop="label"
          :label="i18ns.t('ConsumptionStats.channel')"
          min-width="140"
        />
        <el-table-column
          prop="totalSpend"
          :label="i18ns.t('ConsumptionStats.totalSpend')"
          min-width="120"
        >
          <template #default="{ row }">{{ formatCurrency(row.totalSpend) }}</template>
        </el-table-column>
      </el-table>
    </el-collapse-item>
    <el-collapse-item :title="i18ns.t('ConsumptionStats.modelTable')" name="model">
      <el-table :data="stats.byModel" size="small">
        <el-table-column prop="label" :label="i18ns.t('ConsumptionStats.model')" min-width="160" />
        <el-table-column
          prop="totalSpend"
          :label="i18ns.t('ConsumptionStats.totalSpend')"
          min-width="120"
        >
          <template #default="{ row }">{{ formatCurrency(row.totalSpend) }}</template>
        </el-table-column>
      </el-table>
    </el-collapse-item>
    <el-collapse-item :title="i18ns.t('ConsumptionStats.userTable')" name="user">
      <el-table :data="stats.byUser" size="small">
        <el-table-column prop="label" :label="i18ns.t('ConsumptionStats.user')" min-width="140" />
        <el-table-column
          prop="totalSpend"
          :label="i18ns.t('ConsumptionStats.totalSpend')"
          min-width="120"
        >
          <template #default="{ row }">{{ formatCurrency(row.totalSpend) }}</template>
        </el-table-column>
      </el-table>
    </el-collapse-item>
  </el-collapse>
</template>

<script setup lang="ts">
import { i18ns } from '@/locales'
import type { ConsumptionStatsResponse } from '../types'

defineProps<{
  formatCurrency: (value: number) => string
  formatPercent: (value: number) => string
  isDesktop: boolean
  loading: boolean
  rangeText: string
  stats: ConsumptionStatsResponse
}>()
</script>

<style scoped>
.table-grid {
  margin-bottom: 16px;
}

.table-card {
  border-radius: 10px;
}

.card-header,
.table-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
}

.card-title {
  font-size: 15px;
  font-weight: 600;
}

.mobile-collapse {
  margin-top: 12px;
}
</style>
