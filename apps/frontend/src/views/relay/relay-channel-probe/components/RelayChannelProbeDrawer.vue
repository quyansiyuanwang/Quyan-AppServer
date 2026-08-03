<template>
  <el-drawer
    v-model="drawerOpen"
    :title="selected?.channelName"
    direction="rtl"
    size="min(66vw, 100vw)"
    append-to-body
    destroy-on-close
    @closed="resetDrawer"
  >
    <section v-if="selected" class="probe-drawer-summary">
      <div class="probe-summary-heading">
        <div>
          <span class="eyebrow">{{ i18ns.t('relay.channelProbeTitle') }}</span>
          <strong>{{ selected.channelName }}</strong>
        </div>
        <div class="summary-state-tags">
          <el-tag :type="selected.enabled ? 'success' : 'info'" effect="plain">{{
            selected.enabled ? i18ns.t('relay.enabled') : i18ns.t('relay.disabled')
          }}</el-tag>
          <el-tag :type="selected.profile ? 'success' : 'warning'" effect="plain">{{
            selected.profile ? i18ns.t('relay.channelProbeConfigured') : i18ns.t('no')
          }}</el-tag>
        </div>
      </div>
      <div class="probe-summary-grid">
        <div class="probe-summary-item">
          <span>{{ i18ns.t('relay.channelMultiplier') }}</span>
          <strong>{{ selected.multiplier }}x</strong>
        </div>
        <div class="probe-summary-item">
          <span>{{ i18ns.t('relay.channelProbeLatest') }}</span>
          <div v-if="selected.latestRun" class="summary-run-state">
            <el-tag size="small" :type="statusType(selected.latestRun.status)">{{
              statusLabel(selected.latestRun.status)
            }}</el-tag>
            <small>{{
              formatDate(selected.latestRun.finishedAt ?? selected.latestRun.createTime)
            }}</small>
          </div>
          <strong v-else>-</strong>
        </div>
        <div class="probe-summary-item">
          <span>{{ i18ns.t('relay.channelProbeFormat') }}</span>
          <strong>{{ selected.profile?.probeFormat ?? '-' }}</strong>
          <small>{{
            selected.profile?.probeModel ?? i18ns.t('relay.channelProbeNoProfile')
          }}</small>
        </div>
        <div class="probe-summary-item">
          <span>{{ i18ns.t('relay.channelProbeSuggestion') }}</span>
          <strong>{{
            selected.latestRun?.suggestedMultiplier == null
              ? '-'
              : selected.latestRun.suggestedMultiplier + 'x'
          }}</strong>
          <small v-if="selected.latestRun?.appliedAt">{{
            i18ns.t('relay.channelProbeSuggestionApplied')
          }}</small>
        </div>
        <div class="probe-summary-item probe-summary-wide">
          <span>{{ i18ns.t('relay.channelProbeBalanceDivisor') }}</span>
          <strong v-if="selected.profile">{{
            selected.profile.upstreamCurrency +
            ' / ' +
            formatNumber(selected.profile.upstreamBalanceDivisor) +
            ' × ' +
            formatNumber(selected.profile.upstreamRateMultiplier) +
            ' -> ' +
            selected.profile.localCurrency
          }}</strong>
          <strong v-else>-</strong>
          <small>{{
            selected.profile?.probeGroup
              ? i18ns.t('relay.channelProbeGroup') + ': ' + selected.profile.probeGroup
              : i18ns.t('relay.channelProbeUngrouped')
          }}</small>
        </div>
      </div>
    </section>
    <el-tabs v-model="tab">
      <el-tab-pane :label="i18ns.t('relay.channelProbeProfile')" name="profile">
        <RelayChannelProbeProfileTab />
      </el-tab-pane>
      <el-tab-pane :label="i18ns.t('relay.channelProbeRuns')" name="runs">
        <RelayChannelProbeRunsTab />
      </el-tab-pane>
    </el-tabs>
    <RelayChannelProbeImportDialog />
  </el-drawer>
</template>

<script setup lang="ts">
import { i18ns } from '@/locales'
import { useRelayChannelProbeManagementContext } from '../context'
import RelayChannelProbeImportDialog from './RelayChannelProbeImportDialog.vue'
import RelayChannelProbeProfileTab from './RelayChannelProbeProfileTab.vue'
import RelayChannelProbeRunsTab from './RelayChannelProbeRunsTab.vue'

const {
  drawerOpen,
  selected,
  tab,
  formatDate,
  formatNumber,
  resetDrawer,
  statusLabel,
  statusType,
} = useRelayChannelProbeManagementContext()
</script>
