<template>
  <main class="site-overview">
    <header class="site-overview__header">
      <div>
        <h1>{{ siteName }}</h1>
        <p>{{ i18ns.t('nav.overviewDescription') }}</p>
      </div>
      <el-button
        :icon="Refresh"
        :loading="loading"
        :aria-label="i18ns.t('refresh')"
        circle
        @click="load"
      />
    </header>

    <el-alert
      v-if="partialFailure"
      type="warning"
      :title="i18ns.t('siteOverview.partialFailure')"
      :closable="false"
      show-icon
    />

    <section v-if="!isGuestSite" class="site-overview__metrics" aria-live="polite">
      <article class="site-overview__metric">
        <el-icon><User /></el-icon>
        <div>
          <span>{{ i18ns.t('nav.settingsProfile') }}</span>
          <strong>{{ userLabel }}</strong>
        </div>
      </article>
      <article class="site-overview__metric">
        <el-icon><Key /></el-icon>
        <div>
          <span>{{ i18ns.t('nav.iamAuthorizations') }}</span>
          <strong>{{ permissionStore.effectivePermissions.length }}</strong>
        </div>
      </article>
      <article v-for="metric in metrics" :key="metric.id" class="site-overview__metric">
        <el-icon><DataAnalysis /></el-icon>
        <div>
          <span>{{ i18ns.t(metric.labelKey) }}</span>
          <strong>{{ formatMetricValue(metric.value) }}</strong>
          <small v-if="metric.descriptionKey">{{ i18ns.t(metric.descriptionKey) }}</small>
        </div>
      </article>
    </section>

    <section v-if="actions.length" class="site-overview__actions">
      <el-button
        v-for="action in actions"
        :key="action.route"
        type="primary"
        plain
        @click="router.push({ name: action.route } as any)"
      >
        {{ i18ns.t(action.labelKey) }}
      </el-button>
    </section>
  </main>
</template>

<script setup lang="ts">
import { DataAnalysis, Key, Refresh, User } from '@element-plus/icons-vue'
import { computed } from 'vue'
import { i18ns, type I18nENAvailableKeys } from '@/locales'
import { currentSiteProfile } from '@/router'
import router from '@/router'
import { useSiteOverview } from '@/composables/useSiteOverview'
import { usePermissionStore } from '@/stores/permissionStore'
import { useUserInfoStore } from '@/stores/userInfoStore'

const permissionStore = usePermissionStore()
const userInfoStore = useUserInfoStore()
const { actions, loading, metrics, partialFailure, load } = useSiteOverview()

const siteName = computed(() => i18ns.t(currentSiteProfile.labelKey as I18nENAvailableKeys))
const isGuestSite = computed(
  () => currentSiteProfile.id === 'public' || currentSiteProfile.id === 'identity',
)
const userLabel = computed(
  () =>
    userInfoStore.userInfo.name ||
    userInfoStore.userInfo.username ||
    userInfoStore.userInfo.id ||
    '-',
)

const formatMetricValue = (value: string | number) =>
  value === 'unlimited' ? i18ns.t('siteOverview.unlimited') : value
</script>

<style scoped>
.site-overview {
  display: grid;
  gap: 20px;
  max-width: 1120px;
  margin: 0 auto;
  padding: 24px;
}

.site-overview__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.site-overview__header h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
}

.site-overview__header p {
  margin: 8px 0 0;
  color: var(--el-text-color-secondary);
}

.site-overview__metrics {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}

.site-overview__metric {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 96px;
  padding: 16px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  background: var(--el-bg-color);
}

.site-overview__metric > .el-icon {
  color: var(--el-color-primary);
  font-size: 24px;
}

.site-overview__metric div {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.site-overview__metric span {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.site-overview__metric strong {
  overflow: hidden;
  font-size: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.site-overview__metric small {
  color: var(--el-text-color-secondary);
}

.site-overview__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

@media (max-width: 640px) {
  .site-overview {
    padding: 16px;
  }
}
</style>
