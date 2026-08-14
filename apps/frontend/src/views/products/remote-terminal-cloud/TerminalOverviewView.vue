<template>
  <section class="terminal-overview">
    <header class="terminal-overview__header">
      <div>
        <h1>{{ i18ns.t('remoteTerminal.overview') }}</h1>
        <p>{{ i18ns.t('remoteTerminal.overviewDescription') }}</p>
      </div>
      <el-button :icon="Refresh" :loading="loading" circle @click="loadOverview" />
    </header>

    <el-alert
      v-if="errorMessage"
      type="warning"
      :title="errorMessage"
      show-icon
      :closable="false"
    />

    <div class="terminal-overview__metrics">
      <article v-if="canReadDevices" class="terminal-overview__metric">
        <el-icon><Monitor /></el-icon>
        <div>
          <span>{{ i18ns.t('remoteTerminal.devices') }}</span>
          <strong>{{ usage.activeDeviceCount }} / {{ usage.totalDeviceLimit || '-' }}</strong>
        </div>
      </article>
      <article v-if="canReadSessions" class="terminal-overview__metric">
        <el-icon><Monitor /></el-icon>
        <div>
          <span>{{ i18ns.t('remoteTerminal.terminalQuota') }}</span>
          <strong>{{ usage.activeSessionCount }} / {{ usage.totalTerminalLimit || '-' }}</strong>
        </div>
      </article>
      <article v-if="canReadSubscriptions" class="terminal-overview__metric">
        <el-icon><Tickets /></el-icon>
        <div>
          <span>{{ i18ns.t('remoteTerminal.subscriptions') }}</span>
          <strong>{{ entitlementCount }}</strong>
        </div>
      </article>
    </div>

    <section v-if="canReadDevices || canReadSessions" class="terminal-overview__capacity">
      <div class="terminal-overview__section-heading">
        <div>
          <h2>{{ i18ns.t('remoteTerminal.usageSummary') }}</h2>
          <p>{{ i18ns.t('remoteTerminal.overviewDescription') }}</p>
        </div>
      </div>

      <div class="terminal-overview__capacity-grid">
        <article v-if="canReadDevices" class="terminal-overview__capacity-item">
          <div class="terminal-overview__capacity-heading">
            <span>{{ i18ns.t('remoteTerminal.deviceQuota') }}</span>
            <strong
              >{{ usage.activeDeviceCount }} / {{ formatLimit(usage.totalDeviceLimit) }}</strong
            >
          </div>
          <el-progress
            :percentage="percentage(usage.activeDeviceCount, usage.totalDeviceLimit)"
            :show-text="false"
            :stroke-width="10"
          />
          <small>{{
            i18ns.t('remoteTerminal.remainingQuota', { count: remainingDeviceCapacity })
          }}</small>
        </article>
        <article v-if="canReadSessions" class="terminal-overview__capacity-item">
          <div class="terminal-overview__capacity-heading">
            <span>{{ i18ns.t('remoteTerminal.terminalQuota') }}</span>
            <strong
              >{{ usage.activeSessionCount }} / {{ formatLimit(usage.totalTerminalLimit) }}</strong
            >
          </div>
          <el-progress
            :percentage="percentage(usage.activeSessionCount, usage.totalTerminalLimit)"
            :show-text="false"
            :stroke-width="10"
          />
          <small>{{
            i18ns.t('remoteTerminal.remainingQuota', { count: remainingSessionCapacity })
          }}</small>
        </article>
      </div>
    </section>

    <section v-if="entitlements.length" class="terminal-overview__entitlements">
      <div class="terminal-overview__section-heading">
        <div>
          <h2>{{ i18ns.t('remoteTerminal.subscriptions') }}</h2>
          <p>{{ i18ns.t('remoteTerminal.manageSubscriptions') }}</p>
        </div>
      </div>
      <div class="terminal-overview__entitlement-grid">
        <div class="terminal-overview__entitlement-list">
          <article
            v-for="entitlement in entitlements"
            :key="entitlement.id"
            class="terminal-overview__entitlement"
          >
            <div>
              <strong>{{ entitlement.name }}</strong>
              <small>{{ entitlement.templateName || entitlement.id }}</small>
            </div>
            <dl>
              <div>
                <dt>{{ i18ns.t('remoteTerminal.deviceQuota') }}</dt>
                <dd>{{ entitlement.registeredDeviceCount }} / {{ entitlement.deviceLimit }}</dd>
              </div>
              <div>
                <dt>{{ i18ns.t('remoteTerminal.terminalQuota') }}</dt>
                <dd>{{ entitlement.terminalLimit }}</dd>
              </div>
              <div>
                <dt>{{ i18ns.t('remoteTerminal.expiresAt') }}</dt>
                <dd>{{ formatDateTime(entitlement.endAt) }}</dd>
              </div>
            </dl>
          </article>
        </div>
        <AsyncVChart
          class="terminal-overview__entitlement-chart"
          autoresize
          :option="entitlementChartOption"
        />
      </div>
    </section>

    <SiteOverviewFeatureGrid :previews="featurePreviews" />

    <div class="terminal-overview__actions">
      <el-button
        v-if="canReadDevices || canReadSessions"
        type="primary"
        :icon="Monitor"
        @click="router.push({ name: 'remoteTerminal' })"
      >
        {{ i18ns.t('remoteTerminal.openWorkspace') }}
      </el-button>
      <el-button
        v-if="canReadSubscriptions"
        :icon="Tickets"
        @click="router.push({ name: 'myRemoteTerminalProducts' })"
      >
        {{ i18ns.t('remoteTerminal.manageSubscriptions') }}
      </el-button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { Monitor, Refresh, Tickets } from '@element-plus/icons-vue'
import type { RemoteTerminalUserEntitlementDto } from '@/client/types.gen'
import { computed, onMounted, reactive, ref } from 'vue'
import SiteOverviewFeatureGrid from '@/components/overview/SiteOverviewFeatureGrid.vue'
import { Permission } from '@/constant/permission'
import type { SiteOverviewFeaturePreview } from '@/composables/useSiteOverview'
import { i18ns } from '@/locales'
import router from '@/router'
import { remoteTerminalProductService } from '@/service/remoteTerminalProductService'
import { remoteTerminalService } from '@/service/remoteTerminalService'
import { usePermissionStore } from '@/stores/permissionStore'
import { AsyncVChart } from '@/utils/asyncChart'

const permissionStore = usePermissionStore()
const loading = ref(false)
const errorMessage = ref('')
const entitlementCount = ref(0)
const entitlements = ref<RemoteTerminalUserEntitlementDto[]>([])
const usage = reactive({
  activeSessionCount: 0,
  totalTerminalLimit: 0,
  activeDeviceCount: 0,
  totalDeviceLimit: 0,
})

const canReadDevices = computed(() =>
  permissionStore.hasPermission(Permission.REMOTE_TERMINAL_DEVICE_READ),
)
const canReadSessions = computed(() =>
  permissionStore.hasAnyPermission(
    Permission.REMOTE_TERMINAL_SESSION_READ,
    Permission.REMOTE_TERMINAL_SESSION_CREATE,
  ),
)
const canReadSubscriptions = computed(() =>
  permissionStore.hasPermission(Permission.REMOTE_TERMINAL_PRODUCT_READ),
)

const formatLimit = (limit: number) => (limit > 0 ? limit : '-')
const percentage = (used: number, limit: number) =>
  limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0
const remainingCapacity = (used: number, limit: number) =>
  limit > 0 ? Math.max(limit - used, 0) : '-'
const remainingDeviceCapacity = computed(() =>
  remainingCapacity(usage.activeDeviceCount, usage.totalDeviceLimit),
)
const remainingSessionCapacity = computed(() =>
  remainingCapacity(usage.activeSessionCount, usage.totalTerminalLimit),
)
const formatDateTime = (value: string) => new Date(value).toLocaleString()
const entitlementChartOption = computed<Record<string, unknown>>(() => ({
  color: ['#2563eb', '#0f766e'],
  tooltip: { trigger: 'axis' },
  legend: { bottom: 0 },
  grid: { top: 20, right: 16, bottom: 44, left: 40 },
  xAxis: {
    type: 'category',
    data: entitlements.value.map((entitlement) => entitlement.name),
    axisLabel: { hideOverlap: true },
  },
  yAxis: { type: 'value', minInterval: 1 },
  series: [
    {
      name: i18ns.t('remoteTerminal.deviceQuota'),
      type: 'bar',
      barMaxWidth: 28,
      data: entitlements.value.map((entitlement) => entitlement.deviceLimit),
    },
    {
      name: i18ns.t('remoteTerminal.terminalQuota'),
      type: 'bar',
      barMaxWidth: 28,
      data: entitlements.value.map((entitlement) => entitlement.terminalLimit),
    },
  ],
}))
const featurePreviews = computed<SiteOverviewFeaturePreview[]>(() => [
  ...(canReadDevices.value || canReadSessions.value
    ? [
        {
          route: 'remoteTerminal' as const,
          labelKey: 'nav.remoteTerminal',
          icon: Monitor,
          value: usage.activeSessionCount,
          statisticLabel: i18ns.t('remoteTerminal.terminalQuota'),
          secondary: `${i18ns.t('remoteTerminal.deviceQuota')}: ${usage.activeDeviceCount} / ${formatLimit(usage.totalDeviceLimit)} · ${i18ns.t('remoteTerminal.terminalQuota')}: ${usage.activeSessionCount} / ${formatLimit(usage.totalTerminalLimit)}`,
          hasData: true,
        },
      ]
    : []),
  ...(canReadSubscriptions.value
    ? [
        {
          route: 'myRemoteTerminalProducts' as const,
          labelKey: 'nav.myRemoteTerminalProducts',
          icon: Tickets,
          value: entitlementCount.value,
          statisticLabel: i18ns.t('remoteTerminal.subscriptions'),
          hasData: true,
        },
      ]
    : []),
])

const loadOverview = async () => {
  loading.value = true
  errorMessage.value = ''

  try {
    const [usageResult, entitlementsResult] = await Promise.allSettled([
      canReadDevices.value || canReadSessions.value
        ? remoteTerminalService.getUsageSummary()
        : null,
      canReadSubscriptions.value
        ? remoteTerminalProductService.listMyEntitlements({ page: 1, pageSize: 6 })
        : null,
    ])

    if (usageResult.status === 'fulfilled' && usageResult.value) {
      Object.assign(usage, usageResult.value)
    }
    if (entitlementsResult.status === 'fulfilled' && entitlementsResult.value) {
      entitlementCount.value = entitlementsResult.value.total
      entitlements.value = entitlementsResult.value.records
    }
    if (usageResult.status === 'rejected' || entitlementsResult.status === 'rejected') {
      errorMessage.value = i18ns.t('remoteTerminal.overviewLoadFailed')
    }
  } finally {
    loading.value = false
  }
}

onMounted(() => void loadOverview())
</script>

<style scoped lang="scss">
.terminal-overview {
  display: grid;
  gap: 20px;
}
.terminal-overview__header {
  display: flex;
  justify-content: space-between;
  align-items: start;
  gap: 16px;
}
.terminal-overview__header h1 {
  margin: 0;
  font-size: 20px;
}
.terminal-overview__header p {
  margin: 8px 0 0;
  color: var(--el-text-color-secondary);
}
.terminal-overview__metrics {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 12px;
}
.terminal-overview__metric {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 94px;
  padding: 16px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  background: var(--el-bg-color);
}
.terminal-overview__metric > .el-icon {
  color: var(--el-color-primary);
  font-size: 24px;
}
.terminal-overview__metric div {
  display: grid;
  gap: 5px;
}
.terminal-overview__metric span {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.terminal-overview__metric strong {
  font-size: 20px;
}
.terminal-overview__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.terminal-overview__capacity {
  display: grid;
  gap: 14px;
  padding: 18px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  background: var(--el-bg-color);
}
.terminal-overview__section-heading h2 {
  margin: 0;
  font-size: 16px;
}
.terminal-overview__section-heading p {
  margin: 6px 0 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.terminal-overview__capacity-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 16px;
}
.terminal-overview__capacity-item {
  display: grid;
  gap: 10px;
  min-width: 0;
}
.terminal-overview__capacity-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}
.terminal-overview__capacity-heading span,
.terminal-overview__capacity-item small {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.terminal-overview__capacity-heading strong {
  font-size: 16px;
}
.terminal-overview__entitlements {
  display: grid;
  gap: 14px;
  padding: 18px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  background: var(--el-bg-color);
}
.terminal-overview__entitlement-grid {
  display: grid;
  grid-template-columns: minmax(280px, 0.9fr) minmax(360px, 1.1fr);
  gap: 20px;
  min-width: 0;
}
.terminal-overview__entitlement-list {
  display: grid;
  align-content: start;
  gap: 10px;
  max-height: 300px;
  overflow-y: auto;
}
.terminal-overview__entitlement {
  display: grid;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
}
.terminal-overview__entitlement > div {
  display: grid;
  gap: 4px;
}
.terminal-overview__entitlement small,
.terminal-overview__entitlement dt {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.terminal-overview__entitlement dl {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
}
.terminal-overview__entitlement dl div {
  min-width: 0;
}
.terminal-overview__entitlement dt,
.terminal-overview__entitlement dd {
  margin: 0;
}
.terminal-overview__entitlement dd {
  margin-top: 4px;
  overflow: hidden;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.terminal-overview__entitlement-chart {
  width: 100%;
  min-width: 0;
  height: 300px;
}
@media (max-width: 640px) {
  .terminal-overview__header {
    align-items: center;
  }

  .terminal-overview__entitlement-grid {
    grid-template-columns: 1fr;
  }

  .terminal-overview__entitlement dl {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
