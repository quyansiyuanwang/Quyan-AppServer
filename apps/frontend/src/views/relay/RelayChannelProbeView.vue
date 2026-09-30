<template>
  <main class="channel-probe-page">
    <el-tabs v-model="activePageTab">
      <el-tab-pane :label="i18ns.t('relay.channelProbeTitle')" name="probes">
        <RelayChannelProbeOverview />
      </el-tab-pane>
      <el-tab-pane v-if="state.canManageAccounts.value" :label="i18ns.t('relay.probeAccounts')" name="accounts" lazy>
        <RelayChannelProbeAccountsTab />
      </el-tab-pane>
    </el-tabs>
    <RelayChannelProbeBatchProfileDialog />
    <RelayChannelProbeDrawer />
    <RelayChannelProbeApplyDialog />
    <RelayChannelProbeChangeAnalysisDialog />
  </main>
</template>

<script setup lang="ts">
import { provide, ref } from 'vue'
import { i18ns } from '@/locales'
import RelayChannelProbeAccountsTab from './relay-channel-probe/components/RelayChannelProbeAccountsTab.vue'
import RelayChannelProbeApplyDialog from './relay-channel-probe/components/RelayChannelProbeApplyDialog.vue'
import RelayChannelProbeBatchProfileDialog from './relay-channel-probe/components/RelayChannelProbeBatchProfileDialog.vue'
import RelayChannelProbeChangeAnalysisDialog from './relay-channel-probe/components/RelayChannelProbeChangeAnalysisDialog.vue'
import RelayChannelProbeDrawer from './relay-channel-probe/components/RelayChannelProbeDrawer.vue'
import RelayChannelProbeOverview from './relay-channel-probe/components/RelayChannelProbeOverview.vue'
import { relayChannelProbeManagementContextKey } from './relay-channel-probe/context'
import { useRelayChannelProbeManagement } from './relay-channel-probe/useRelayChannelProbeManagement'
import './relay-channel-probe/relay-channel-probe.scss'

const state = useRelayChannelProbeManagement()
const activePageTab = ref('probes')

provide(relayChannelProbeManagementContextKey, state)
</script>
