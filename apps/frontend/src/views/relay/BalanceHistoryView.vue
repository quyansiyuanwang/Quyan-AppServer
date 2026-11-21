<template>
  <AccountProfileLayout class="billing-page" :class="isDesktop ? 'desktop-page' : 'mobile-page'">
    <BalanceHistorySummary mode="balance" />
    <BalanceTransferPanel class="billing-section" @changed="handleBalanceChanged" />
    <AlipayOrdersPanel class="billing-section" @changed="handleBalanceChanged" />
    <BalanceHistoryTransactions scope="account" />
  </AccountProfileLayout>
</template>

<script setup lang="ts">
import { provide } from 'vue'
import AccountProfileLayout from '@/layouts/AccountProfileLayout.vue'
import BalanceHistorySummary from './balance-history/components/BalanceHistorySummary.vue'
import BalanceHistoryTransactions from './balance-history/components/BalanceHistoryTransactions.vue'
import BalanceTransferPanel from './balance-history/components/BalanceTransferPanel.vue'
import AlipayOrdersPanel from '@/components/balance/AlipayOrdersPanel.vue'
import { balanceHistoryContextKey } from './balance-history/context'
import { useBalanceHistory } from './balance-history/useBalanceHistory'

const state = useBalanceHistory()
const isDesktop = state.isDesktop

const handleBalanceChanged = async () => {
  await Promise.all([state.refreshBalanceAndStats(), state.refreshTransactions()])
}

provide(balanceHistoryContextKey, state)
defineExpose(state)
</script>

<style lang="scss" src="./balance-history/balance-history.scss"></style>
