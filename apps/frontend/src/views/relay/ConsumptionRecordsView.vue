<template>
  <AccountProfileLayout class="billing-page" :class="isDesktop ? 'desktop-page' : 'mobile-page'">
    <BalanceHistorySummary mode="consumption" />
    <BalanceHistoryTransactions scope="consumption" />
  </AccountProfileLayout>
</template>

<script setup lang="ts">
import { provide } from 'vue'
import AccountProfileLayout from '@/layouts/AccountProfileLayout.vue'
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
