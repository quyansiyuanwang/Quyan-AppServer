<template>
  <main class="channel-health-page">
    <header class="page-header">
      <div>
        <h1>{{ i18ns.t('relay.channelHealthManagement') }}</h1>
        <p>{{ i18ns.t('relay.channelHealthManagementDescription') }}</p>
      </div>
      <el-button :icon="Refresh" :loading="loading" @click="loadOverview">{{
        i18ns.t('refresh')
      }}</el-button>
    </header>

    <el-alert v-if="error" type="error" :closable="false" show-icon class="mb-4">
      <template #default>
        <span>{{ error }}</span>
        <el-button link type="primary" :loading="loading" @click="loadOverview">{{
          i18ns.t('reload')
        }}</el-button>
      </template>
    </el-alert>

    <section class="summary-grid" aria-label="Channel health summary">
      <div class="summary-item">
        <span>{{ i18ns.t('relay.healthAutomaticCount') }}</span
        ><strong>{{ automaticCount }}</strong>
      </div>
      <div class="summary-item">
        <span>{{ i18ns.t('relay.healthManualCount') }}</span
        ><strong>{{ manualCount }}</strong>
      </div>
      <div class="summary-item">
        <span>{{ i18ns.t('relay.healthDisabledCount') }}</span
        ><strong>{{ disabledCount }}</strong>
      </div>
      <div class="summary-item">
        <span>{{ i18ns.t('relay.healthHealthyCount') }}</span
        ><strong>{{ healthyCount }}</strong>
      </div>
    </section>

    <section class="content-section">
      <div class="toolbar">
        <el-input v-model="keyword" clearable :placeholder="i18ns.t('search')" class="search-input">
          <template #prefix
            ><el-icon><Search /></el-icon
          ></template>
        </el-input>
        <el-select v-model="modeFilter" class="filter-select">
          <el-option value="all" :label="i18ns.t('relay.healthAllModes')" />
          <el-option value="automatic" :label="i18ns.t('relay.healthTrackingAutomatic')" />
          <el-option value="manual" :label="i18ns.t('relay.healthTrackingManual')" />
          <el-option value="disabled" :label="i18ns.t('relay.healthTrackingDisabled')" />
        </el-select>
        <el-select v-model="statusFilter" class="filter-select">
          <el-option value="all" :label="i18ns.t('relay.healthAllStatuses')" />
          <el-option value="enabled" :label="i18ns.t('relay.healthEnabled')" />
          <el-option value="disabled" :label="i18ns.t('relay.healthDisabled')" />
        </el-select>
        <el-button
          v-if="canUpdate"
          type="primary"
          plain
          :disabled="selectedChannelIds.length === 0"
          @click="openBatchEditor"
        >
          {{ i18ns.t('relay.healthBatchEdit') }}
        </el-button>
        <el-button
          v-if="canUpdate"
          type="danger"
          plain
          :disabled="selectedChannelIds.length === 0"
          :loading="batchClearing"
          @click="confirmBatchClear"
        >
          {{ i18ns.t('relay.healthBatchClear') }}
        </el-button>
      </div>

      <el-table
        v-loading="loading"
        :data="filteredChannels"
        class="health-table"
        row-key="channelId"
        @selection-change="onSelectionChange"
      >
        <el-table-column type="selection" width="46" :selectable="() => canUpdate" />
        <el-table-column prop="name" :label="i18ns.t('relay.channelName')" min-width="180" />
        <el-table-column :label="i18ns.t('status')" width="105">
          <template #default="{ row }"
            ><el-tag :type="row.enabled ? 'success' : 'info'" size="small">{{
              row.enabled ? i18ns.t('relay.healthEnabled') : i18ns.t('relay.healthDisabled')
            }}</el-tag></template
          >
        </el-table-column>
        <el-table-column :label="i18ns.t('relay.healthTrackingMode')" min-width="130">
          <template #default="{ row }"
            ><el-tag size="small" :type="trackingTagType(row.trackingMode)">{{
              trackingLabel(row.trackingMode)
            }}</el-tag></template
          >
        </el-table-column>
        <el-table-column :label="i18ns.t('relay.healthAvailability')" width="115" align="right">
          <template #default="{ row }">{{ formatPercent(row.availability) }}</template>
        </el-table-column>
        <el-table-column
          :label="i18ns.t('relay.healthSamples')"
          prop="sampleCount"
          width="95"
          align="right"
        />
        <el-table-column :label="i18ns.t('relay.healthLatency')" width="130" align="right">
          <template #default="{ row }">{{ formatLatency(row.averageLatencyMs) }}</template>
        </el-table-column>
        <el-table-column label="2xx / 4xx / 5xx" min-width="130" align="right">
          <template #default="{ row }"
            >{{ row.status2xxCount }} / {{ row.status4xxCount }} /
            {{ row.status5xxCount }}</template
          >
        </el-table-column>
        <el-table-column :label="i18ns.t('relay.healthLastSeen')" min-width="170">
          <template #default="{ row }">{{ formatTime(row.lastSeenAt) }}</template>
        </el-table-column>
        <el-table-column :label="i18ns.t('actions')" width="180" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openDrawer(row)">{{
              i18ns.t('relay.healthManage')
            }}</el-button>
            <el-button
              v-if="canUpdate"
              link
              type="danger"
              :loading="clearingId === row.channelId"
              @click="confirmClear(row)"
              >{{ i18ns.t('relay.healthClear') }}</el-button
            >
          </template>
        </el-table-column>
        <template #empty
          ><el-empty :description="i18ns.t('relay.healthNoChannels')" :image-size="88"
        /></template>
      </el-table>
    </section>

    <section class="pool-route-section" aria-label="Automatic proxy pool route order">
      <div class="pool-route-section__header">
        <div>
          <h2>{{ i18ns.t('relay.automaticPoolBaseRouteOrder') }}</h2>
          <p>{{ i18ns.t('relay.automaticPoolRoutePageHelp') }}</p>
        </div>
        <el-button :icon="Refresh" :loading="automaticPoolsLoading" @click="loadAutomaticPoolRoutes">
          {{ i18ns.t('refresh') }}
        </el-button>
      </div>
      <el-alert v-if="automaticPoolsError" type="warning" :closable="false" show-icon class="mb-3">
        {{ automaticPoolsError }}
      </el-alert>
      <el-empty
        v-else-if="!automaticPoolsLoading && automaticPools.length === 0"
        :description="i18ns.t('relay.automaticPoolRouteEmpty')"
        :image-size="72"
      />
      <el-collapse v-else class="pool-route-collapse">
        <el-collapse-item v-for="pool in automaticPools" :key="pool.channelId" :name="pool.channelId">
          <template #title>
            <div class="pool-route-title">
              <strong>{{ pool.name }}</strong>
              <el-tag size="small" type="primary">
                {{ pool.rankingMode === 'price-first'
                  ? i18ns.t('relay.automaticPoolRankingPriceFirst')
                  : i18ns.t('relay.automaticPoolRankingStabilityFirst') }}
              </el-tag>
              <el-tag size="small" :type="pool.dynamicMemberRankingEnabled ? 'success' : 'info'">
                {{ pool.dynamicMemberRankingEnabled
                  ? i18ns.t('relay.automaticPoolDynamicEnabled')
                  : i18ns.t('relay.automaticPoolDynamicDisabled') }}
              </el-tag>
            </div>
          </template>
          <div class="pool-route-meta">
            {{ i18ns.t('relay.automaticPoolRouteWindow', {
              start: formatTime(pool.windowStartAt),
              end: formatTime(pool.windowEndAt),
            }) }}
            <el-button link type="primary" :loading="refreshingPoolId === pool.channelId" @click="refreshAutomaticPoolRoute(pool.channelId)">
              {{ i18ns.t('refresh') }}
            </el-button>
          </div>
          <el-table :data="pool.members" size="small" class="pool-route-table">
            <el-table-column :label="i18ns.t('relay.healthRank')" prop="rank" width="70" />
            <el-table-column :label="i18ns.t('relay.channelName')" prop="name" min-width="150" />
            <el-table-column :label="i18ns.t('relay.automaticPoolAttemptable')" width="95">
              <template #default="{ row }">
                <el-tag size="small" :type="row.eligible ? 'success' : 'danger'">
                  {{ row.eligible ? i18ns.t('yes') : i18ns.t('no') }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column :label="i18ns.t('relay.healthEffectivePrice')" width="110" align="right">
              <template #default="{ row }">{{ Number(row.effectivePrice).toFixed(4) }}x</template>
            </el-table-column>
            <el-table-column :label="i18ns.t('relay.healthAvailability')" width="110" align="right">
              <template #default="{ row }">{{ formatPercent(row.availability) }}</template>
            </el-table-column>
            <el-table-column :label="i18ns.t('relay.healthSamples')" prop="sampleCount" width="88" align="right" />
            <el-table-column :label="i18ns.t('relay.healthLatency')" width="110" align="right">
              <template #default="{ row }">{{ formatLatency(row.averageLatencyMs) }}</template>
            </el-table-column>
            <el-table-column :label="i18ns.t('relay.healthFailures')" prop="failureCount" width="82" align="right" />
            <el-table-column :label="i18ns.t('relay.automaticPoolExclusionReason')" min-width="160">
              <template #default="{ row }">{{ formatExclusionReasons(row.exclusionReasons) }}</template>
            </el-table-column>
          </el-table>
        </el-collapse-item>
      </el-collapse>
    </section>

    <el-dialog
      v-model="batchEditorOpen"
      :title="i18ns.t('relay.healthBatchEditTitle')"
      width="min(480px, calc(100vw - 32px))"
      destroy-on-close
    >
      <el-form label-position="top" @submit.prevent="saveBatchConfig">
        <el-form-item :label="i18ns.t('relay.healthTrackingMode')">
          <el-radio-group v-model="batchMode">
            <el-radio value="automatic">{{ i18ns.t('relay.healthTrackingAutomatic') }}</el-radio>
            <el-radio value="manual">{{ i18ns.t('relay.healthTrackingManual') }}</el-radio>
            <el-radio value="disabled">{{ i18ns.t('relay.healthTrackingDisabled') }}</el-radio>
          </el-radio-group>
        </el-form-item>
        <template v-if="batchMode === 'manual'">
          <el-form-item :label="i18ns.t('relay.healthManualAvailability')">
            <el-input-number
              v-model="batchManualAvailability"
              :min="0"
              :max="1"
              :step="0.01"
              :precision="2"
            />
          </el-form-item>
          <el-form-item :label="i18ns.t('relay.healthManualLatency')">
            <el-input-number v-model="batchManualLatencyMs" :min="0" :step="10" />
          </el-form-item>
        </template>
      </el-form>
      <template #footer>
        <el-button @click="batchEditorOpen = false">{{ i18ns.t('cancel') }}</el-button>
        <el-button type="primary" :loading="batchSaving" @click="saveBatchConfig">{{
          i18ns.t('save')
        }}</el-button>
      </template>
    </el-dialog>

    <el-drawer
      v-model="drawerOpen"
      :title="selected?.name"
      size="min(560px, 100vw)"
      destroy-on-close
      @closed="resetDrawer"
    >
      <template v-if="selected">
        <el-descriptions :column="2" border class="mb-5">
          <el-descriptions-item :label="i18ns.t('relay.healthSource')">{{
            sourceLabel(selected.source)
          }}</el-descriptions-item>
          <el-descriptions-item :label="i18ns.t('relay.healthSamples')">{{
            selected.sampleCount
          }}</el-descriptions-item>
          <el-descriptions-item :label="i18ns.t('relay.healthAvailability')">{{
            formatPercent(selected.availability)
          }}</el-descriptions-item>
          <el-descriptions-item :label="i18ns.t('relay.healthLatency')">{{
            formatLatency(selected.averageLatencyMs)
          }}</el-descriptions-item>
        </el-descriptions>

        <el-form v-if="canUpdate" label-position="top" @submit.prevent="saveConfig">
          <el-form-item :label="i18ns.t('relay.healthTrackingMode')">
            <el-radio-group v-model="editMode">
              <el-radio value="automatic">{{ i18ns.t('relay.healthTrackingAutomatic') }}</el-radio>
              <el-radio value="manual">{{ i18ns.t('relay.healthTrackingManual') }}</el-radio>
              <el-radio value="disabled">{{ i18ns.t('relay.healthTrackingDisabled') }}</el-radio>
            </el-radio-group>
          </el-form-item>
          <template v-if="editMode === 'manual'">
            <el-form-item :label="i18ns.t('relay.healthManualAvailability')">
              <el-input-number
                v-model="manualAvailability"
                :min="0"
                :max="1"
                :step="0.01"
                :precision="2"
              />
            </el-form-item>
            <el-form-item :label="i18ns.t('relay.healthManualLatency')">
              <el-input-number v-model="manualLatencyMs" :min="0" :step="10" />
            </el-form-item>
          </template>
          <div class="drawer-actions">
            <el-button type="primary" native-type="submit" :loading="saving">{{
              i18ns.t('save')
            }}</el-button>
            <el-button
              type="danger"
              plain
              :loading="clearingId === selected.channelId"
              @click="confirmClear(selected)"
              >{{ i18ns.t('relay.healthClear') }}</el-button
            >
          </div>
        </el-form>
      </template>
    </el-drawer>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh, Search } from '@element-plus/icons-vue'
import { Permission } from '@/constant/permission'
import { i18ns } from '@/locales'
import { relayChannelService } from '@/service/relayChannelService'
import { usePermissionStore } from '@/stores/permissionStore'
import { getErrorMessage } from '@/utils/error-utils'
import type {
  RelayAutomaticPoolHealthDto,
  RelayChannelHealthOverviewItemDto,
  RelayChannelHealthTrackingMode,
} from '@/client/types.gen'

const permissionStore = usePermissionStore()
const loading = ref(false)
const error = ref('')
const keyword = ref('')
const modeFilter = ref<'all' | RelayChannelHealthTrackingMode>('all')
const statusFilter = ref<'all' | 'enabled' | 'disabled'>('enabled')
const channels = ref<RelayChannelHealthOverviewItemDto[]>([])
const drawerOpen = ref(false)
const selected = ref<RelayChannelHealthOverviewItemDto | null>(null)
const editMode = ref<RelayChannelHealthTrackingMode>('automatic')
const manualAvailability = ref(1)
const manualLatencyMs = ref(0)
const saving = ref(false)
const clearingId = ref<string | null>(null)
const selectedChannelIds = ref<string[]>([])
const batchEditorOpen = ref(false)
const batchMode = ref<RelayChannelHealthTrackingMode>('automatic')
const batchManualAvailability = ref(1)
const batchManualLatencyMs = ref(0)
const batchSaving = ref(false)
const batchClearing = ref(false)
const automaticPools = ref<RelayAutomaticPoolHealthDto[]>([])
const automaticPoolsLoading = ref(false)
const automaticPoolsError = ref('')
const refreshingPoolId = ref<string | null>(null)
let latestRequest = 0

const canUpdate = computed(() => permissionStore.hasPermission(Permission.RELAY_CHANNEL_UPDATE))
const automaticCount = computed(
  () => channels.value.filter((item) => item.trackingMode === 'automatic').length,
)
const manualCount = computed(
  () => channels.value.filter((item) => item.trackingMode === 'manual').length,
)
const disabledCount = computed(
  () => channels.value.filter((item) => item.trackingMode === 'disabled').length,
)
const healthyCount = computed(
  () => channels.value.filter((item) => item.sampleCount > 0 && item.availability >= 0.95).length,
)
const filteredChannels = computed(() => {
  const normalizedKeyword = keyword.value.trim().toLowerCase()
  return channels.value.filter(
    (item) =>
      (!normalizedKeyword ||
        item.name.toLowerCase().includes(normalizedKeyword) ||
        item.channelId.toLowerCase().includes(normalizedKeyword)) &&
      (modeFilter.value === 'all' || item.trackingMode === modeFilter.value) &&
      (statusFilter.value === 'all' || (statusFilter.value === 'enabled') === item.enabled),
  )
})

const trackingLabel = (mode: RelayChannelHealthTrackingMode) =>
  i18ns.t(
    `relay.healthTracking${mode === 'automatic' ? 'Automatic' : mode === 'manual' ? 'Manual' : 'Disabled'}`,
  )
const sourceLabel = (source: 'redis' | 'manual' | 'disabled') =>
  i18ns.t(
    `relay.healthSource${source === 'redis' ? 'Redis' : source === 'manual' ? 'Manual' : 'Disabled'}`,
  )
const trackingTagType = (mode: RelayChannelHealthTrackingMode) =>
  mode === 'automatic' ? 'success' : mode === 'manual' ? 'warning' : 'info'
const formatPercent = (value: number) => `${(Math.max(0, Math.min(1, value)) * 100).toFixed(1)}%`
const formatLatency = (value: number) => (value > 0 ? `${Math.round(value)} ms` : '-')
const formatTime = (value?: string | Date) => (value ? new Date(value).toLocaleString() : '-')
const formatExclusionReasons = (reasons: string[] | null | undefined) => {
  if (!reasons?.length) return '-'
  const labels: Record<string, string> = {
    disabled: i18ns.t('relay.automaticPoolExcludedDisabled'),
    availability: i18ns.t('relay.automaticPoolExcludedAvailability'),
    latency: i18ns.t('relay.automaticPoolExcludedLatency'),
    'circuit-breaker': i18ns.t('relay.automaticPoolExcludedCircuitBreaker'),
  }
  return reasons.map((reason) => labels[reason] || reason).join(', ')
}

const loadOverview = async () => {
  const requestId = ++latestRequest
  loading.value = true
  error.value = ''
  try {
    const result = await relayChannelService.getChannelHealthOverview()
    if (requestId !== latestRequest) return
    channels.value = result.channels
    selectedChannelIds.value = []
    void loadAutomaticPoolRoutes()
  } catch (cause) {
    if (requestId !== latestRequest) return
    error.value = getErrorMessage(cause, i18ns.t('relay.healthLoadFailed'))
    ElMessage.error(error.value)
  } finally {
    if (requestId === latestRequest) loading.value = false
  }
}

const loadAutomaticPoolRoutes = async () => {
  if (automaticPoolsLoading.value) return
  automaticPoolsLoading.value = true
  automaticPoolsError.value = ''
  try {
    const allChannels = await relayChannelService.listChannels({ includeDisabled: true })
    const poolChannels = allChannels.filter((channel) => channel.channelType === 'automatic-proxy-pool')
    const results = await Promise.all(poolChannels.map((channel) => relayChannelService.getChannelHealth(channel.id)))
    automaticPools.value = results.filter(
      (result): result is RelayAutomaticPoolHealthDto => 'members' in result,
    )
  } catch (cause) {
    automaticPools.value = []
    automaticPoolsError.value = getErrorMessage(cause, i18ns.t('relay.healthLoadFailed'))
  } finally {
    automaticPoolsLoading.value = false
  }
}

const refreshAutomaticPoolRoute = async (channelId: string) => {
  refreshingPoolId.value = channelId
  try {
    const result = await relayChannelService.getChannelHealth(channelId)
    if (!('members' in result)) return
    const index = automaticPools.value.findIndex((pool) => pool.channelId === channelId)
    if (index >= 0) automaticPools.value.splice(index, 1, result)
  } catch (cause) {
    ElMessage.error(getErrorMessage(cause, i18ns.t('relay.healthLoadFailed')))
  } finally {
    refreshingPoolId.value = null
  }
}

const onSelectionChange = (rows: RelayChannelHealthOverviewItemDto[]) => {
  selectedChannelIds.value = rows.map((row) => row.channelId)
}

const openDrawer = (item: RelayChannelHealthOverviewItemDto) => {
  selected.value = item
  editMode.value = item.trackingMode
  manualAvailability.value = item.manualAvailability ?? item.availability ?? 1
  manualLatencyMs.value = item.manualLatencyMs ?? item.averageLatencyMs ?? 0
  drawerOpen.value = true
}

const resetDrawer = () => {
  selected.value = null
  saving.value = false
}

const saveConfig = async () => {
  if (!selected.value || saving.value) return
  saving.value = true
  try {
    const updated = await relayChannelService.updateChannelHealthConfig(selected.value.channelId, {
      healthTrackingMode: editMode.value,
      ...(editMode.value === 'manual'
        ? { manualAvailability: manualAvailability.value, manualLatencyMs: manualLatencyMs.value }
        : {}),
    })
    selected.value = { ...selected.value, ...updated }
    ElMessage.success(i18ns.t('relay.healthSaveSuccess'))
    await loadOverview()
  } catch (cause) {
    ElMessage.error(getErrorMessage(cause, i18ns.t('operationFailed')))
  } finally {
    saving.value = false
  }
}

const confirmClear = async (item: RelayChannelHealthOverviewItemDto) => {
  if (!canUpdate.value || clearingId.value) return
  try {
    await ElMessageBox.confirm(i18ns.t('relay.healthClearConfirm'), i18ns.t('warning'), {
      type: 'warning',
    })
  } catch {
    return
  }
  clearingId.value = item.channelId
  try {
    await relayChannelService.clearChannelHealth(item.channelId)
    ElMessage.success(i18ns.t('relay.healthClearSuccess'))
    await loadOverview()
  } catch (cause) {
    ElMessage.error(getErrorMessage(cause, i18ns.t('operationFailed')))
  } finally {
    clearingId.value = null
  }
}

const openBatchEditor = () => {
  if (!selectedChannelIds.value.length) {
    ElMessage.warning(i18ns.t('relay.healthSelectFirst'))
    return
  }
  batchMode.value = 'automatic'
  batchManualAvailability.value = 1
  batchManualLatencyMs.value = 0
  batchEditorOpen.value = true
}

const saveBatchConfig = async () => {
  if (!selectedChannelIds.value.length || batchSaving.value) return
  batchSaving.value = true
  try {
    const result = await relayChannelService.batchUpdateChannelHealthConfig({
      ids: selectedChannelIds.value,
      healthTrackingMode: batchMode.value,
      ...(batchMode.value === 'manual'
        ? {
            manualAvailability: batchManualAvailability.value,
            manualLatencyMs: batchManualLatencyMs.value,
          }
        : {}),
    })
    batchEditorOpen.value = false
    ElMessage.success(i18ns.t('relay.healthBatchSaveSuccess', { count: result.affected }))
    await loadOverview()
  } catch (cause) {
    ElMessage.error(getErrorMessage(cause, i18ns.t('operationFailed')))
  } finally {
    batchSaving.value = false
  }
}

const confirmBatchClear = async () => {
  if (!selectedChannelIds.value.length || batchClearing.value) return
  try {
    await ElMessageBox.confirm(i18ns.t('relay.healthBatchClearConfirm'), i18ns.t('warning'), {
      type: 'warning',
    })
  } catch {
    return
  }
  batchClearing.value = true
  try {
    const result = await relayChannelService.batchClearChannelHealth(selectedChannelIds.value)
    ElMessage.success(i18ns.t('relay.healthBatchClearSuccess', { count: result.affected }))
    await loadOverview()
  } catch (cause) {
    ElMessage.error(getErrorMessage(cause, i18ns.t('operationFailed')))
  } finally {
    batchClearing.value = false
  }
}

onMounted(loadOverview)
</script>

<style scoped>
.channel-health-page {
  width: 100%;
  min-width: 0;
  padding: 24px;
}
.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}
.page-header h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
}
.page-header p {
  margin: 6px 0 0;
  color: var(--el-text-color-secondary);
}
.summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  border: 1px solid var(--el-border-color-lighter);
  margin-bottom: 20px;
}
.summary-item {
  min-height: 78px;
  padding: 14px 18px;
  border-right: 1px solid var(--el-border-color-lighter);
  display: grid;
  align-content: center;
  gap: 5px;
}
.summary-item:last-child {
  border-right: 0;
}
.summary-item span {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.summary-item strong {
  font-size: 24px;
  line-height: 1;
}
.content-section {
  min-width: 0;
}
.pool-route-section {
  margin-top: 24px;
  min-width: 0;
}
.pool-route-section__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
}
.pool-route-section__header h2 {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
}
.pool-route-section__header p,
.pool-route-meta {
  margin: 5px 0 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.pool-route-title {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}
.pool-route-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 0 0 10px;
}
.pool-route-table {
  width: 100%;
}
.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 14px;
}
.search-input {
  width: min(360px, 100%);
}
.filter-select {
  width: 150px;
}
.health-table {
  width: 100%;
}
.drawer-actions {
  display: flex;
  gap: 10px;
  margin-top: 20px;
}
@media (max-width: 760px) {
  .channel-health-page {
    padding: 16px;
  }
  .page-header {
    flex-direction: column;
  }
  .summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .summary-item:nth-child(2) {
    border-right: 0;
  }
  .summary-item:nth-child(-n + 2) {
    border-bottom: 1px solid var(--el-border-color-lighter);
  }
  .filter-select {
    flex: 1 1 145px;
  }
  .health-table {
    min-width: 920px;
  }
  .content-section {
    overflow-x: auto;
  }
  .pool-route-section {
    overflow-x: auto;
  }
  .pool-route-table {
    min-width: 980px;
  }
}
</style>
