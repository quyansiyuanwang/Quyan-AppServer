<template>
  <header class="page-header">
    <div>
      <h1>{{ i18ns.t('relay.channelProbeTitle') }}</h1>
      <p>{{ i18ns.t('relay.channelProbeDescription') }}</p>
    </div>
    <div class="page-header-actions">
      <el-button plain @click="changeDialogOpen = true">{{
        i18ns.t('relay.channelProbeChangeAnalysis')
      }}</el-button>
      <el-button :icon="Refresh" :loading="loading" @click="loadOverview">{{
        i18ns.t('refresh')
      }}</el-button>
    </div>
  </header>

  <el-alert
    type="info"
    :closable="false"
    show-icon
    class="mb-4"
    :title="i18ns.t('relay.channelProbeQueueNotice')"
  />
  <el-alert v-if="pageError" type="error" :closable="false" show-icon class="mb-4">
    <template #default
      ><span>{{ pageError }}</span
      ><el-button link type="primary" @click="loadOverview">{{
        i18ns.t('reload')
      }}</el-button></template
    >
  </el-alert>

  <section class="probe-filters">
    <el-input
      v-model.trim="keyword"
      clearable
      :placeholder="i18ns.t('relay.channelProbeSearchPlaceholder')"
    />
    <el-select v-model="profileFilter">
      <el-option value="all" :label="i18ns.t('relay.channelProbeFilterAllProfiles')" />
      <el-option value="configured" :label="i18ns.t('relay.channelProbeFilterConfigured')" />
      <el-option value="unconfigured" :label="i18ns.t('relay.channelProbeFilterUnconfigured')" />
    </el-select>
    <el-select v-model="enabledFilter">
      <el-option value="all" :label="i18ns.t('relay.channelProbeFilterAllStates')" />
      <el-option value="enabled" :label="i18ns.t('relay.enabled')" />
      <el-option value="disabled" :label="i18ns.t('relay.disabled')" />
    </el-select>
    <el-select v-model="runStatusFilter">
      <el-option value="all" :label="i18ns.t('relay.channelProbeFilterAllRuns')" />
      <el-option value="none" :label="i18ns.t('relay.channelProbeFilterNoRuns')" />
      <el-option
        v-for="status in runStatuses"
        :key="status"
        :value="status"
        :label="statusLabel(status)"
      />
    </el-select>
    <el-select v-model="suggestionFilter">
      <el-option value="all" :label="i18ns.t('relay.channelProbeFilterAllSuggestions')" />
      <el-option value="applicable" :label="i18ns.t('relay.channelProbeFilterApplicable')" />
      <el-option value="not_applicable" :label="i18ns.t('relay.channelProbeFilterNotApplicable')" />
    </el-select>
  </section>
  <section class="probe-toolbar">
    <span class="selection-summary">{{
      i18ns.t('relay.channelProbeSelected', { count: selectedRows.length })
    }}</span>
    <el-button
      v-if="canExecute"
      type="primary"
      plain
      :disabled="!canBatchCopyProfile"
      @click="openBatchProfileDialog"
      >{{ i18ns.t('relay.channelProbeBatchConfigure') }}</el-button
    >
    <el-button
      v-if="canExecute"
      type="primary"
      plain
      :disabled="runnableTargets.length === 0"
      :loading="batchRunning"
      @click="confirmBatchRun"
      >{{ i18ns.t('relay.channelProbeBatchRun') }}</el-button
    >
    <el-checkbox v-if="canExecute" v-model="forceWithoutCacheBuster" :disabled="batchRunning">
      {{ i18ns.t('relay.channelProbeForceWithoutCacheBuster') }}
    </el-checkbox>
    <el-button
      v-if="canAdjust"
      type="success"
      plain
      :disabled="selectedRuns.length === 0"
      :loading="applying"
      @click="confirmApply(selectedRuns)"
      >{{ i18ns.t('relay.channelProbeBatchApply') }}</el-button
    >
  </section>
  <el-table
    ref="tableRef"
    v-loading="loading"
    :data="filteredItems"
    row-key="channelId"
    class="w-full"
    @selection-change="onSelectionChange"
  >
    <el-table-column type="expand" width="44">
      <template #default="{ row }">
        <el-table v-if="row.channelType === 'pooled'" :data="row.members ?? []" size="small">
          <el-table-column
            prop="channelName"
            :label="i18ns.t('relay.channelName')"
            min-width="180"
          />
          <el-table-column :label="i18ns.t('status')" width="112">
            <template #default="{ row: member }">
              <el-tag size="small" :type="member.enabled ? 'success' : 'info'">
                {{ member.enabled ? i18ns.t('relay.enabled') : i18ns.t('relay.disabled') }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column :label="i18ns.t('relay.channelProbeConfigured')" width="128">
            <template #default="{ row: member }">
              <el-tag size="small" :type="member.hasCredentials ? 'success' : 'warning'">
                {{ member.hasCredentials ? i18ns.t('yes') : i18ns.t('no') }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column :label="i18ns.t('relay.channelProbeLatest')" width="128">
            <template #default="{ row: member }">
              {{ member.latestRun ? statusLabel(member.latestRun.status) : '-' }}
            </template>
          </el-table-column>
          <el-table-column :label="i18ns.t('actions')" width="260" fixed="right">
            <template #default="{ row: member }">
              <el-button link type="primary" @click="openMemberDrawer(row, member)">
                {{ i18ns.t('relay.channelProbeManage') }}
              </el-button>
              <el-button
                v-if="canExecute"
                link
                type="primary"
                :disabled="
                  !row.profile || !member.enabled || !member.compatible || !member.hasCredentials
                "
                :loading="runningId === `${row.channelId}:${member.channelId}`"
                @click="run(row, member.channelId)"
                >{{ i18ns.t('relay.channelProbeRun') }}</el-button
              >
              <el-button
                v-if="canExecute"
                link
                type="warning"
                :loading="resettingChannelId === `${row.channelId}:${member.channelId}`"
                @click="confirmResetRunState(row, member.channelId)"
                >{{ i18ns.t('relay.channelProbeResetState') }}</el-button
              >
              <el-button
                v-if="canAdjust"
                link
                type="success"
                :disabled="!isApplicable(member.latestRun)"
                @click="confirmApply([member.latestRun!.id])"
                >{{ i18ns.t('relay.channelProbeApply') }}</el-button
              >
            </template>
          </el-table-column>
        </el-table>
      </template>
    </el-table-column>
    <el-table-column type="selection" width="46" :selectable="canSelectRow" />
    <el-table-column prop="channelName" :label="i18ns.t('relay.channelName')" min-width="180" />
    <el-table-column :label="i18ns.t('status')" width="108"
      ><template #default="{ row }"
        ><el-tag size="small" :type="row.enabled ? 'success' : 'info'">{{
          row.enabled ? i18ns.t('relay.enabled') : i18ns.t('relay.disabled')
        }}</el-tag></template
      ></el-table-column
    >
    <el-table-column :label="i18ns.t('relay.channelMultiplier')" width="120" align="right"
      ><template #default="{ row }">{{ row.multiplier }}x</template></el-table-column
    >
    <el-table-column :label="i18ns.t('relay.channelProbeConfigured')" width="126"
      ><template #default="{ row }"
        ><el-tag size="small" :type="row.profile ? 'success' : 'info'">{{
          row.profile ? i18ns.t('yes') : i18ns.t('no')
        }}</el-tag></template
      ></el-table-column
    >
    <el-table-column :label="i18ns.t('relay.channelProbeLatest')" width="120"
      ><template #default="{ row }">{{
        row.latestRun ? statusLabel(row.latestRun.status) : '-'
      }}</template></el-table-column
    >
    <el-table-column :label="i18ns.t('relay.channelProbeSuggestion')" width="100" align="right"
      ><template #default="{ row }">{{
        row.latestRun?.suggestedMultiplier == null ? '-' : `${row.latestRun.suggestedMultiplier}x`
      }}</template></el-table-column
    >
    <el-table-column :label="i18ns.t('actions')" fixed="right" width="360"
      ><template #default="{ row }">
        <el-button link type="primary" @click="openDrawer(row)">{{
          i18ns.t('relay.channelProbeManage')
        }}</el-button>
        <el-button
          v-if="canExecute && row.channelType !== 'pooled'"
          link
          type="primary"
          :disabled="!row.profile || !row.enabled"
          :loading="runningId === `${row.channelId}:`"
          @click="run(row)"
          >{{ i18ns.t('relay.channelProbeRun') }}</el-button
        >
        <el-button
          v-if="canExecute && row.channelType === 'pooled'"
          link
          type="primary"
          :disabled="
            !row.profile ||
            !(row.members ?? []).some(
              (member: RelayChannelProbeMemberDto) =>
                member.enabled && member.compatible && member.hasCredentials,
            )
          "
          :loading="batchRunning"
          @click="confirmRunAllMembers(row)"
          >{{ i18ns.t('relay.channelProbeBatchRun') }}</el-button
        >
        <el-button
          v-if="canExecute"
          link
          type="warning"
          :loading="resettingChannelId === `${row.channelId}:`"
          @click="confirmResetRunState(row)"
          >{{ i18ns.t('relay.channelProbeResetState') }}</el-button
        >
        <el-button
          v-if="canAdjust"
          link
          type="success"
          :disabled="!isApplicable(row.latestRun)"
          @click="confirmApply([row.latestRun!.id])"
          >{{ i18ns.t('relay.channelProbeApply') }}</el-button
        >
      </template></el-table-column
    >
    <template #empty
      ><el-empty :description="i18ns.t('relay.channelProbeNoStandalone')" :image-size="88"
    /></template>
  </el-table>
</template>

<script setup lang="ts">
import { Refresh } from '@element-plus/icons-vue'
import { i18ns } from '@/locales'
import type { RelayChannelProbeMemberDto } from '@/client/types.gen'
import { useRelayChannelProbeManagementContext } from '../context'

const {
  applying,
  batchRunning,
  canAdjust,
  canBatchCopyProfile,
  canExecute,
  canSelectRow,
  changeDialogOpen,
  confirmApply,
  confirmRunAllMembers,
  confirmBatchRun,
  confirmResetRunState,
  enabledFilter,
  filteredItems,
  forceWithoutCacheBuster,
  isApplicable,
  keyword,
  loadOverview,
  loading,
  onSelectionChange,
  openBatchProfileDialog,
  openDrawer,
  openMemberDrawer,
  pageError,
  profileFilter,
  resettingChannelId,
  run,
  runStatuses,
  runStatusFilter,
  runningId,
  runnableTargets,
  selectedRows,
  selectedRuns,
  statusLabel,
  suggestionFilter,
  tableRef,
} = useRelayChannelProbeManagementContext()
</script>
