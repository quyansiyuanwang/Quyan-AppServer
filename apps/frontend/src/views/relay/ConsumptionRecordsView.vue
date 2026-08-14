<template>
  <AccountProfileLayout
    :class="[
      isDesktop ? 'desktop-page page-shell' : 'mobile-page',
      'balance-history-page-root',
      'balance-history-page-root--consumption',
    ]"
  >
    <div class="balance-container">
      <header class="consumption-records__heading">
        <h1>{{ i18ns.t('nav.consumptionRecords') }}</h1>
      </header>
      <BalanceHistorySummary
        :card-class="isDesktop ? 'page-card' : 'mobile-card'"
        :show-balance="false"
      />
      <BalanceHistoryTransactions
        :card-class="isDesktop ? 'page-card' : 'mobile-card'"
        scope="consumption"
      />
    </div>
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
const i18ns = state.i18ns

provide(balanceHistoryContextKey, state)
defineExpose(state)
</script>

<style lang="scss" src="./balance-history/balance-history.scss"></style>

<style scoped>
.consumption-records__heading {
  margin-bottom: 0;
}

.consumption-records__heading h1 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
}
</style>
