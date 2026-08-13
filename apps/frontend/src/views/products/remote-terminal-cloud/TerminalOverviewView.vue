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
import { computed, onMounted, reactive, ref } from 'vue'
import { Permission } from '@/constant/permission'
import { i18ns } from '@/locales'
import router from '@/router'
import { remoteTerminalProductService } from '@/service/remoteTerminalProductService'
import { remoteTerminalService } from '@/service/remoteTerminalService'
import { usePermissionStore } from '@/stores/permissionStore'

const permissionStore = usePermissionStore()
const loading = ref(false)
const errorMessage = ref('')
const entitlementCount = ref(0)
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

const loadOverview = async () => {
  loading.value = true
  errorMessage.value = ''

  try {
    const [usageResult, entitlementsResult] = await Promise.allSettled([
      canReadDevices.value || canReadSessions.value
        ? remoteTerminalService.getUsageSummary()
        : null,
      canReadSubscriptions.value
        ? remoteTerminalProductService.listMyEntitlements({ page: 1, pageSize: 1 })
        : null,
    ])

    if (usageResult.status === 'fulfilled' && usageResult.value) {
      Object.assign(usage, usageResult.value)
    }
    if (entitlementsResult.status === 'fulfilled' && entitlementsResult.value) {
      entitlementCount.value = entitlementsResult.value.total
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
@media (max-width: 640px) {
  .terminal-overview__header {
    align-items: center;
  }
}
</style>
