<template>
  <div :class="[isDesktop ? 'desktop-page page-shell' : 'mobile-page', 'balance-history-page-root']">
    <div class="balance-container">
      <BalanceHistorySummary :card-class="isDesktop ? 'page-card' : 'mobile-card'" />
      <BalanceHistoryTransactions :card-class="isDesktop ? 'page-card' : 'mobile-card'" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { provide } from 'vue'
import BalanceHistorySummary from './balance-history/components/BalanceHistorySummary.vue'
import BalanceHistoryTransactions from './balance-history/components/BalanceHistoryTransactions.vue'
import { balanceHistoryContextKey } from './balance-history/context'
import { useBalanceHistory } from './balance-history/useBalanceHistory'

const state = useBalanceHistory()
const isDesktop = state.isDesktop

provide(balanceHistoryContextKey, state)
defineExpose(state)
</script>

<style lang="scss" src="./balance-history/balance-history.scss"></style>
