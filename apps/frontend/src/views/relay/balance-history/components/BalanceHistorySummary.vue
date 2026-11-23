<script setup lang="ts">
import { computed } from 'vue'
import { BALANCE_MANAGEMENT_POLICY } from '@quyan/shared'
import { Refresh, Switch } from '@element-plus/icons-vue'
import { AsyncVChart as VChart } from '@/utils/asyncChart'
import { useBalanceHistoryContext } from '../context'
import { useConsumptionQuota } from '../useConsumptionQuota'

defineProps<{ mode: 'balance' | 'consumption' }>()

const {
  i18ns,
  userInfoStore,
  loadingStats,
  refreshingBalance,
  balanceAccount,
  refreshBalanceAndStats,
  redeemCode,
  handleRedeem,
  redeeming,
  usageStats,
  loadingAllData,
  requestCount,
  showCharts,
  requestsChartOption,
  avgTPM,
  tpmChartOption,
  avgRPM,
  rpmChartOption,
} = useBalanceHistoryContext()

const overdraft = computed(() => balanceAccount.value?.overdraft)
const formatCredit = (amount: number | undefined) =>
  amount === undefined
    ? '—'
    : amount.toLocaleString(undefined, {
        maximumFractionDigits: BALANCE_MANAGEMENT_POLICY.decimals,
      })
const overdraftStatus = computed(() => {
  if (refreshingBalance.value) return 'balance.overdraft.loading'
  if (!overdraft.value) return 'balance.overdraft.unavailable'
  if (!overdraft.value.accountActive) return 'balance.overdraft.accountInactive'
  if (overdraft.value.calculationError) return 'balance.overdraft.calculationError'
  if (overdraft.value.overdraftLimit <= 0 || !overdraft.value.categories.length)
    return 'balance.overdraft.disabled'
  return 'balance.overdraft.hint'
})
const creditMetrics = computed(
  () =>
    [
      { key: 'limit', value: overdraft.value?.overdraftLimit },
      { key: 'used', value: overdraft.value?.usedOverdraft },
      { key: 'remaining', value: overdraft.value?.remainingOverdraft },
    ] as const,
)

const {
  label: quotaLabel,
  switchLabel: switchQuotaLabel,
  amount: consumedQuota,
  loading: loadingQuota,
  cycleRange: cycleQuotaRange,
} = useConsumptionQuota(usageStats)

const usedPercent = computed(() =>
  usageStats.value.total > 0
    ? Math.round(((consumedQuota.value ?? 0) / usageStats.value.total) * 100)
    : 0,
)
const trends = computed(
  () =>
    [
      {
        label: 'balance.totalRequests',
        value: requestCount.value,
        option: requestsChartOption.value,
      },
      { label: 'balance.avgTPM', value: avgTPM.value.toFixed(2), option: tpmChartOption.value },
      { label: 'balance.avgRPM', value: avgRPM.value.toFixed(2), option: rpmChartOption.value },
    ] as const,
)
</script>

<template>
  <el-card
    class="billing-summary"
    v-loading="loadingStats"
    :element-loading-text="i18ns.t('relay.firstLoadTip')"
  >
    <h1>{{ i18ns.t(mode === 'balance' ? 'nav.balanceHistory' : 'nav.consumptionRecords') }}</h1>
    <div v-if="mode === 'balance'" class="balance-overview">
      <div class="balance-figure">
        <div class="balance-figure__label">
          {{ i18ns.t('relay.accountBalance') }}
          <el-button
            :icon="Refresh"
            :loading="refreshingBalance"
            :aria-label="i18ns.t('refresh')"
            :title="i18ns.t('refresh')"
            link
            @click="refreshBalanceAndStats"
          />
        </div>
        <div class="balance-figure__value">
          {{ userInfoStore.userInfo.balance ?? 0 }} <small>{{ i18ns.t('balance.yuan') }}</small>
        </div>
      </div>
      <form class="balance-redeem" @submit.prevent="handleRedeem">
        <label for="balance-redeem-code">{{ i18ns.t('redemption.code') }}</label>
        <div class="balance-redeem__controls">
          <el-input
            id="balance-redeem-code"
            v-model="redeemCode"
            :placeholder="i18ns.t('redemption.enterCode')"
            clearable
          />
          <el-button type="primary" native-type="submit" :loading="redeeming">{{
            i18ns.t('redemption.redeem')
          }}</el-button>
        </div>
      </form>
    </div>
    <section
      v-if="mode === 'balance'"
      class="balance-credit"
      :aria-label="i18ns.t('balance.overdraft.title')"
      :aria-busy="refreshingBalance"
      aria-live="polite"
    >
      <h2>{{ i18ns.t('balance.overdraft.title') }}</h2>
      <dl class="balance-credit__metrics">
        <div v-for="metric in creditMetrics" :key="metric.key" :data-credit="metric.key">
          <dt>{{ i18ns.t(`balance.overdraft.${metric.key}`) }}</dt>
          <dd>
            {{ formatCredit(metric.value) }} <small>{{ i18ns.t('balance.yuan') }}</small>
          </dd>
        </div>
      </dl>
      <p class="balance-credit__hint" role="status">{{ i18ns.t(overdraftStatus) }}</p>
      <p v-if="overdraft?.categories.length" class="balance-credit__hint">
        {{ i18ns.t('balance.overdraft.scope') }}
        {{
          overdraft.categories
            .map((category) => i18ns.t(`balance.overdraft.category.${category}`))
            .join(' / ')
        }}
      </p>
    </section>
    <dl v-else class="usage-metrics">
      <div class="usage-metric" v-loading="loadingQuota">
        <dt class="usage-metric__heading">
          <span>{{ quotaLabel }}</span>
          <el-button
            class="usage-metric__switch"
            :icon="Switch"
            :aria-label="switchQuotaLabel"
            :title="switchQuotaLabel"
            link
            @click="cycleQuotaRange"
          />
        </dt>
        <dd aria-live="polite" :aria-busy="loadingQuota">
          {{ consumedQuota ?? '—' }} <small>/ {{ usageStats.total }}</small>
        </dd>
        <dd class="usage-metric__visual">
          <el-progress
            v-if="consumedQuota !== null"
            :percentage="Math.min(100, Math.max(0, usedPercent))"
            :format="() => usedPercent + '%'"
            :stroke-width="4"
          />
        </dd>
      </div>
      <div
        v-for="trend in trends"
        :key="trend.label"
        class="usage-metric"
        v-loading="loadingAllData"
      >
        <dt>{{ i18ns.t(trend.label) }}</dt>
        <dd>{{ trend.value }}</dd>
        <dd class="usage-metric__visual" aria-hidden="true">
          <v-chart v-if="showCharts" :option="trend.option" autoresize />
        </dd>
      </div>
    </dl>
  </el-card>
</template>
