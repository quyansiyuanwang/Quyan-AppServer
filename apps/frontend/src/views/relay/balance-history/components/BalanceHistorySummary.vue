<script setup lang="ts">
import { Refresh, Wallet } from '@element-plus/icons-vue'
import { AsyncVChart as VChart } from '@/utils/asyncChart'
import { useBalanceHistoryContext } from '../context'

defineProps<{
  cardClass: string
}>()

const state = useBalanceHistoryContext()
const i18ns = state.i18ns
const userInfoStore = state.userInfoStore
const loadingStats = state.loadingStats
const refreshingBalance = state.refreshingBalance
const refreshBalanceAndStats = state.refreshBalanceAndStats
const redeemCode = state.redeemCode
const handleRedeem = state.handleRedeem
const redeeming = state.redeeming
const usageStats = state.usageStats
const loadingAllData = state.loadingAllData
const requestCount = state.requestCount
const showCharts = state.showCharts
const requestsChartOption = state.requestsChartOption
const avgTPM = state.avgTPM
const tpmChartOption = state.tpmChartOption
const avgRPM = state.avgRPM
const rpmChartOption = state.rpmChartOption
</script>

<template>
  <el-card
    :class="['info-card', cardClass]"
    v-loading="loadingStats"
    :element-loading-text="loadingStats ? i18ns.t('relay.firstLoadTip') : ''"
  >
    <div class="card-header-section">
      <el-row :gutter="20" align="middle">
        <el-col :xs="24" :sm="12" :md="10">
          <div class="balance-info">
            <span class="balance-label">
              <el-icon><Wallet /></el-icon>
              {{ i18ns.t('relay.accountBalance') }}
              <el-button
                :icon="Refresh"
                :loading="refreshingBalance"
                @click="refreshBalanceAndStats"
                size="small"
                class="balance-refresh-btn"
              >
                {{ i18ns.t('refresh') }}
              </el-button>
            </span>
            <span class="balance-amount">{{ userInfoStore.userInfo.balance ?? 0 }}</span>
          </div>
        </el-col>
        <el-col :xs="24" :sm="12" :md="14">
          <el-form inline class="redeem-form toolbar-row">
            <el-form-item :label="i18ns.t('redemption.code')" style="margin-bottom: 0">
              <el-input
                v-model="redeemCode"
                :placeholder="i18ns.t('redemption.enterCode')"
                style="width: 100%; max-width: 240px"
                clearable
              />
            </el-form-item>
            <el-form-item style="margin-bottom: 0">
              <el-button type="primary" @click="handleRedeem" :loading="redeeming">
                {{ i18ns.t('redemption.redeem') }}
              </el-button>
            </el-form-item>
          </el-form>
        </el-col>
      </el-row>
    </div>

    <el-divider />

    <div class="statistics-section">
      <el-row :gutter="16" class="stats-row">
        <el-col :xs="24" :sm="12" :md="6">
          <div class="stat-item">
            <div class="stat-content">
              <div class="stat-info">
                <span class="stat-label">{{ i18ns.t('balance.usedQuota') }}</span>
                <span class="stat-value">{{ usageStats.used }}</span>
                <span class="stat-total">/ {{ usageStats.total }}</span>
              </div>
              <div class="stat-chart">
                <el-progress
                  type="circle"
                  :percentage="
                    Math.round(
                      usageStats.total > 0 ? (usageStats.used / usageStats.total) * 100 : 0,
                    )
                  "
                  :width="60"
                  :stroke-width="6"
                />
              </div>
            </div>
          </div>
        </el-col>
        <el-col :xs="24" :sm="12" :md="6">
          <div class="stat-item" v-loading="loadingAllData">
            <div class="stat-content">
              <div class="stat-info">
                <span class="stat-label">{{ i18ns.t('balance.totalRequests') }}</span>
                <span class="stat-value">{{ requestCount }}</span>
              </div>
              <div class="stat-chart">
                <v-chart
                  v-if="showCharts"
                  :option="requestsChartOption"
                  style="height: 60px; width: 100%"
                />
              </div>
            </div>
          </div>
        </el-col>
        <el-col :xs="24" :sm="12" :md="6">
          <div class="stat-item" v-loading="loadingAllData">
            <div class="stat-content">
              <div class="stat-info">
                <span class="stat-label">{{ i18ns.t('balance.avgTPM') }}</span>
                <span class="stat-value">{{ avgTPM.toFixed(2) }}</span>
              </div>
              <div class="stat-chart">
                <v-chart
                  v-if="showCharts"
                  :option="tpmChartOption"
                  style="height: 60px; width: 100%"
                />
              </div>
            </div>
          </div>
        </el-col>
        <el-col :xs="24" :sm="12" :md="6">
          <div class="stat-item" v-loading="loadingAllData">
            <div class="stat-content">
              <div class="stat-info">
                <span class="stat-label">{{ i18ns.t('balance.avgRPM') }}</span>
                <span class="stat-value">{{ avgRPM.toFixed(2) }}</span>
              </div>
              <div class="stat-chart">
                <v-chart
                  v-if="showCharts"
                  :option="rpmChartOption"
                  style="height: 60px; width: 100%"
                />
              </div>
            </div>
          </div>
        </el-col>
      </el-row>
    </div>
  </el-card>
</template>
