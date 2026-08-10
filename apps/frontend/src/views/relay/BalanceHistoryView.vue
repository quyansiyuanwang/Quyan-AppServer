<template>
  <AccountProfileLayout
    :class="[
      isDesktop ? 'desktop-page page-shell' : 'mobile-page',
      'balance-history-page-root',
      'balance-history-page-root--balance',
    ]"
  >
    <div class="balance-container">
      <BalanceHistorySummary
        :card-class="isDesktop ? 'page-card' : 'mobile-card'"
        :show-statistics="false"
      />
      <BalanceTransferPanel @changed="handleBalanceChanged" />
      <BalanceHistoryTransactions
        :card-class="isDesktop ? 'page-card' : 'mobile-card'"
        scope="account"
      />
    </div>
  </AccountProfileLayout>
</template>

<script setup lang="ts">
import { provide } from 'vue'
import AccountProfileLayout from '@/layouts/AccountProfileLayout.vue'
import BalanceHistorySummary from './balance-history/components/BalanceHistorySummary.vue'
import BalanceHistoryTransactions from './balance-history/components/BalanceHistoryTransactions.vue'
import BalanceTransferPanel from './balance-history/components/BalanceTransferPanel.vue'
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
