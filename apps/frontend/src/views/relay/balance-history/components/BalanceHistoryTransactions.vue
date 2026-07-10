<script setup lang="ts">
import ComponentErrorBoundary from '@/components/common/ComponentErrorBoundary.vue'
import TransactionHistory from '@/components/balance/TransactionHistory.vue'
import { useBalanceHistoryContext } from '../context'

defineProps<{
  cardClass: string
}>()

const state = useBalanceHistoryContext()
const allTransactions = state.allTransactions
const loading = state.loading
const loadingAllData = state.loadingAllData
const historyRangeHint = state.historyRangeHint
const historyRangeSlider = state.historyRangeSlider
const incrementalUpdateTransactions = state.incrementalUpdateTransactions
const handleHistorySliderChange = state.handleHistorySliderChange
</script>

<template>
  <el-card :class="['transaction-card', cardClass]">
    <ComponentErrorBoundary>
      <TransactionHistory
        :transactions="allTransactions"
        :loading="loading"
        :loading-full="loadingAllData"
        :range-hint="historyRangeHint"
        :range-slider="historyRangeSlider"
        @refresh="incrementalUpdateTransactions"
        @range-slider-change="handleHistorySliderChange"
      />
    </ComponentErrorBoundary>
  </el-card>
</template>
