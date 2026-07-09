<template>
  <div class="ip-monitor-view">
    <IpMonitoringDashboardTabs />
    <IpMonitoringDashboardDialogs />
  </div>
</template>

<script setup lang="ts">
import { provide } from 'vue'
import IpMonitoringDashboardDialogs from './ip-monitoring-dashboard/components/IpMonitoringDashboardDialogs.vue'
import IpMonitoringDashboardTabs from './ip-monitoring-dashboard/components/IpMonitoringDashboardTabs.vue'
import { ipMonitoringDashboardContextKey } from './ip-monitoring-dashboard/context'
import { useIpMonitoringDashboard } from './ip-monitoring-dashboard/useIpMonitoringDashboard'
import './ip-monitoring-dashboard/ip-monitoring-dashboard.scss'

const state = useIpMonitoringDashboard()

provide(ipMonitoringDashboardContextKey, state)
</script>
