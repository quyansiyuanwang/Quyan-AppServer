import { computed, type ComputedRef, type Ref } from 'vue'
import { i18ns } from '@/locales'
import type { ConsumptionStatsResponse } from './types'

export interface ConsumptionSummaryCard {
  key: string
  label: string
  value: string
  hint: string
}

export interface ConsumptionChartOptions {
  summaryCards: ComputedRef<ConsumptionSummaryCard[]>
  dailyTrendOption: ComputedRef<Record<string, unknown>>
  channelPieOption: ComputedRef<Record<string, unknown>>
  modelBarOption: ComputedRef<Record<string, unknown>>
  userBarOption: ComputedRef<Record<string, unknown>>
}

export const createConsumptionChartOptions = (
  stats: Ref<ConsumptionStatsResponse>,
  formatCurrency: (value: number) => string,
  formatNumber: (value: number) => string,
): ConsumptionChartOptions => {
  const summaryCards = computed<ConsumptionSummaryCard[]>(() => [
    {
      key: 'totalSpend',
      label: i18ns.t('ConsumptionStats.totalSpend'),
      value: formatCurrency(stats.value.summary.totalSpend),
      hint: `${i18ns.t('ConsumptionStats.chargedSpend')}: ${formatCurrency(stats.value.summary.chargedSpend)}`,
    },
    {
      key: 'coveredSpend',
      label: i18ns.t('ConsumptionStats.coveredSpend'),
      value: formatCurrency(stats.value.summary.coveredSpend),
      hint: `${i18ns.t('ConsumptionStats.zeroChargeRequests')}: ${formatNumber(stats.value.summary.zeroChargeRequests)}`,
    },
    {
      key: 'consumingUsers',
      label: i18ns.t('ConsumptionStats.consumingUsers'),
      value: formatNumber(stats.value.summary.consumingUsers),
      hint: `${i18ns.t('ConsumptionStats.activeUsers')}: ${formatNumber(stats.value.summary.activeUsers)}`,
    },
    {
      key: 'requests',
      label: i18ns.t('ConsumptionStats.requests'),
      value: formatNumber(stats.value.summary.totalRequests),
      hint: `${i18ns.t('ConsumptionStats.avgSpendPerRequest')}: ${formatCurrency(stats.value.summary.avgSpendPerRequest)}`,
    },
    {
      key: 'tokens',
      label: i18ns.t('ConsumptionStats.tokens'),
      value: formatNumber(stats.value.summary.totalTokens),
      hint: `${i18ns.t('ConsumptionStats.avgTokensPerRequest')}: ${formatNumber(stats.value.summary.avgTokensPerRequest)}`,
    },
    {
      key: 'cacheTokens',
      label: i18ns.t('ConsumptionStats.cacheTokens'),
      value: formatNumber(
        stats.value.summary.cacheCreationTokens + stats.value.summary.cacheReadTokens,
      ),
      hint: `${i18ns.t('ConsumptionStats.inputOutputTokens')}: ${formatNumber(stats.value.summary.inputTokens)} / ${formatNumber(stats.value.summary.outputTokens)}`,
    },
  ])

  const dailyTrendOption = computed<Record<string, unknown>>(() => ({
    tooltip: { trigger: 'axis' },
    legend: { bottom: 0 },
    grid: { left: 40, right: 20, top: 20, bottom: 50 },
    xAxis: {
      type: 'category',
      data: stats.value.daily.map((item) => item.date),
    },
    yAxis: [
      {
        type: 'value',
        name: i18ns.t('ConsumptionStats.totalSpend'),
      },
      {
        type: 'value',
        name: i18ns.t('ConsumptionStats.requests'),
      },
    ],
    series: [
      {
        name: i18ns.t('ConsumptionStats.totalSpend'),
        type: 'line',
        smooth: true,
        data: stats.value.daily.map((item) => item.totalSpend),
      },
      {
        name: i18ns.t('ConsumptionStats.requests'),
        type: 'bar',
        yAxisIndex: 1,
        data: stats.value.daily.map((item) => item.totalRequests),
      },
      {
        name: i18ns.t('ConsumptionStats.consumingUsers'),
        type: 'line',
        smooth: true,
        yAxisIndex: 1,
        data: stats.value.daily.map((item) => item.consumingUsers),
      },
    ],
  }))

  const channelPieOption = computed<Record<string, unknown>>(() => ({
    tooltip: { trigger: 'item' },
    legend: { orient: 'vertical', left: 0, top: 'middle' },
    series: [
      {
        name: i18ns.t('ConsumptionStats.channelDistribution'),
        type: 'pie',
        radius: ['40%', '70%'],
        center: ['65%', '50%'],
        data: stats.value.byChannel.slice(0, 8).map((item) => ({
          name: item.label,
          value: item.totalSpend,
        })),
        label: { formatter: '{b}: {d}%' },
      },
    ],
  }))

  const modelBarOption = computed<Record<string, unknown>>(() => ({
    tooltip: { trigger: 'axis' },
    grid: { left: 40, right: 20, top: 20, bottom: 70 },
    xAxis: {
      type: 'category',
      axisLabel: { rotate: 35 },
      data: stats.value.byModel.slice(0, 10).map((item) => item.label),
    },
    yAxis: { type: 'value' },
    series: [
      {
        name: i18ns.t('ConsumptionStats.totalSpend'),
        type: 'bar',
        data: stats.value.byModel.slice(0, 10).map((item) => item.totalSpend),
      },
    ],
  }))

  const userBarOption = computed<Record<string, unknown>>(() => ({
    tooltip: { trigger: 'axis' },
    grid: { left: 40, right: 20, top: 20, bottom: 70 },
    xAxis: {
      type: 'category',
      axisLabel: { rotate: 35 },
      data: stats.value.byUser.slice(0, 10).map((item) => item.label),
    },
    yAxis: { type: 'value' },
    series: [
      {
        name: i18ns.t('ConsumptionStats.totalSpend'),
        type: 'bar',
        data: stats.value.byUser.slice(0, 10).map((item) => item.totalSpend),
      },
    ],
  }))

  return {
    summaryCards,
    dailyTrendOption,
    channelPieOption,
    modelBarOption,
    userBarOption,
  }
}
