<template>
  <main class="channel-probe-page">
    <RelayChannelProbeOverview />
    <RelayChannelProbeBatchProfileDialog />
    <RelayChannelProbeDrawer />
    <RelayChannelProbeApplyDialog />
    <RelayChannelProbeChangeAnalysisDialog />
  </main>
</template>

<script setup lang="ts">
import { provide } from 'vue'
import RelayChannelProbeApplyDialog from './relay-channel-probe/components/RelayChannelProbeApplyDialog.vue'
import RelayChannelProbeBatchProfileDialog from './relay-channel-probe/components/RelayChannelProbeBatchProfileDialog.vue'
import RelayChannelProbeChangeAnalysisDialog from './relay-channel-probe/components/RelayChannelProbeChangeAnalysisDialog.vue'
import RelayChannelProbeDrawer from './relay-channel-probe/components/RelayChannelProbeDrawer.vue'
import RelayChannelProbeOverview from './relay-channel-probe/components/RelayChannelProbeOverview.vue'
import { relayChannelProbeManagementContextKey } from './relay-channel-probe/context'
import { useRelayChannelProbeManagement } from './relay-channel-probe/useRelayChannelProbeManagement'
import './relay-channel-probe/relay-channel-probe.scss'

const state = useRelayChannelProbeManagement()

provide(relayChannelProbeManagementContextKey, state)
</script>
