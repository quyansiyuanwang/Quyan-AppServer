<template>
  <div class="monthly-pass-management-view">
    <MonthlyPassManagementTabs />
    <MonthlyPassManagementDialogs />
  </div>
</template>

<script setup lang="ts">
import { provide } from 'vue'
import MonthlyPassManagementDialogs from './monthly-pass-management/components/MonthlyPassManagementDialogs.vue'
import MonthlyPassManagementTabs from './monthly-pass-management/components/MonthlyPassManagementTabs.vue'
import { monthlyPassManagementContextKey } from './monthly-pass-management/context'
import { useMonthlyPassManagement } from './monthly-pass-management/useMonthlyPassManagement'
import './monthly-pass-management/monthly-pass-management.scss'

const state = useMonthlyPassManagement()

provide(monthlyPassManagementContextKey, state)
</script>
