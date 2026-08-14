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

    <SiteOverviewCharts :charts="charts" />

    <SiteOverviewFeatureGrid :previews="featurePreviews" />

    <section v-if="details.length || breakdown.length" class="site-overview__detail-grid">
      <el-card v-if="details.length" shadow="never" class="site-overview__detail-panel">
        <template #header>
          <div class="site-overview__panel-heading">
            <span>{{ i18ns.t('siteOverview.details.title') }}</span>
            <el-tag size="small" type="info">{{ details.length }}</el-tag>
          </div>
        </template>
        <div class="site-overview__detail-list">
          <div v-for="detail in details" :key="detail.id" class="site-overview__detail-row">
            <span>{{ detail.label || (detail.labelKey ? i18ns.t(detail.labelKey) : '') }}</span>
            <strong>{{ formatDetailValue(detail.value) }}</strong>
            <small v-if="detail.secondary">{{ detail.secondary }}</small>
          </div>
        </div>
      </el-card>

      <el-card v-if="breakdown.length" shadow="never" class="site-overview__detail-panel">
        <template #header>
          <div class="site-overview__panel-heading">
            <span>{{ i18ns.t('siteOverview.details.distribution') }}</span>
            <el-icon><DataAnalysis /></el-icon>
          </div>
        </template>
        <div
          class="site-overview__breakdown"
          role="img"
          :aria-label="i18ns.t('siteOverview.details.distribution')"
        >
          <div v-for="item in breakdown" :key="item.id" class="site-overview__breakdown-row">
            <div class="site-overview__breakdown-label">
              <span>{{ item.label }}</span>
              <strong>{{ formatMetricValue(item.value) }}</strong>
            </div>
            <div class="site-overview__bar-track">
              <span
                class="site-overview__bar"
                :class="`is-${item.tone}`"
                :style="{ width: `${breakdownPercent(item.value)}%` }"
              />
            </div>
          </div>
        </div>
      </el-card>
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
import SiteOverviewCharts from '@/components/overview/SiteOverviewCharts.vue'
import SiteOverviewFeatureGrid from '@/components/overview/SiteOverviewFeatureGrid.vue'
import { usePermissionStore } from '@/stores/permissionStore'
import { useUserInfoStore } from '@/stores/userInfoStore'

const permissionStore = usePermissionStore()
const userInfoStore = useUserInfoStore()
const {
  actions,
  breakdown,
  charts,
  details,
  featurePreviews,
  loading,
  metrics,
  partialFailure,
  load,
} = useSiteOverview()

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

const formatDetailValue = (value: string | number) => {
  if (value === 'unlimited') return i18ns.t('siteOverview.unlimited')
  if (value === 'enabled') return i18ns.t('siteOverview.details.enabled')
  if (value === 'disabled') return i18ns.t('siteOverview.details.disabled')
  return value
}

const breakdownMax = computed(() => Math.max(...breakdown.value.map((item) => item.value), 1))
const breakdownPercent = (value: number) =>
  Math.max(4, Math.round((value / breakdownMax.value) * 100))
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

.site-overview__detail-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(300px, 0.85fr);
  gap: 16px;
}

.site-overview__detail-panel {
  min-width: 0;
}

.site-overview__panel-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-weight: 600;
}

.site-overview__detail-list,
.site-overview__breakdown {
  display: grid;
  gap: 14px;
}

.site-overview__detail-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 4px 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.site-overview__detail-row:last-child {
  padding-bottom: 0;
  border-bottom: 0;
}

.site-overview__detail-row span,
.site-overview__detail-row small {
  color: var(--el-text-color-secondary);
}

.site-overview__detail-row small {
  grid-column: 1 / -1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.site-overview__breakdown-row {
  display: grid;
  gap: 8px;
}

.site-overview__breakdown-label {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  color: var(--el-text-color-secondary);
}

.site-overview__breakdown-label strong {
  color: var(--el-text-color-primary);
}

.site-overview__bar-track {
  height: 10px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--el-fill-color-light);
}

.site-overview__bar {
  display: block;
  height: 100%;
  min-width: 4px;
  border-radius: inherit;
  transition: width 240ms ease;
}

.site-overview__bar.is-primary {
  background: var(--el-color-primary);
}

.site-overview__bar.is-success {
  background: var(--el-color-success);
}

.site-overview__bar.is-warning {
  background: var(--el-color-warning);
}

@media (max-width: 640px) {
  .site-overview {
    padding: 16px;
  }

  .site-overview__detail-grid {
    grid-template-columns: 1fr;
  }
}
</style>
