<template>
  <section v-if="previews.length" class="site-overview-features" aria-live="polite">
    <header class="site-overview-features__header">
      <div>
        <h2>{{ i18ns.t('siteOverview.features.title') }}</h2>
        <p>{{ i18ns.t('siteOverview.features.description') }}</p>
      </div>
      <el-tag type="info" effect="plain">{{ previews.length }}</el-tag>
    </header>

    <div class="site-overview-features__grid">
      <button
        v-for="preview in previews"
        :key="`${preview.route}-${preview.labelKey}`"
        type="button"
        class="site-overview-features__card"
        :class="{ 'has-data': preview.hasData }"
        @click="router.push({ name: preview.route } as any)"
      >
        <el-icon><component :is="preview.icon" /></el-icon>
        <span class="site-overview-features__content">
          <strong>{{ preview.label || i18ns.t(preview.labelKey as any) }}</strong>
          <small>{{ preview.statisticLabel }}</small>
        </span>
        <span class="site-overview-features__value">{{ formatValue(preview.value) }}</span>
        <small v-if="preview.secondary" class="site-overview-features__secondary">
          {{ preview.secondary }}
        </small>
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { SiteOverviewFeaturePreview } from '@/composables/useSiteOverview'
import { i18ns } from '@/locales'
import router from '@/router'

defineProps<{
  previews: readonly SiteOverviewFeaturePreview[]
}>()

const formatValue = (value: string | number) =>
  value === 'unlimited' ? i18ns.t('siteOverview.unlimited') : value
</script>

<style scoped>
.site-overview-features {
  display: grid;
  gap: 14px;
  padding: 18px;
  border-top: 3px solid var(--el-color-primary);
  background: var(--el-fill-color-extra-light);
}

.site-overview-features__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.site-overview-features__header h2 {
  margin: 0;
  font-size: 16px;
}

.site-overview-features__header p {
  margin: 5px 0 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.site-overview-features__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 10px;
}

.site-overview-features__card {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 4px 10px;
  min-height: 76px;
  padding: 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  background: var(--el-bg-color);
  color: var(--el-text-color-primary);
  text-align: left;
  cursor: pointer;
}

.site-overview-features__card:hover,
.site-overview-features__card:focus-visible {
  border-color: var(--el-color-primary-light-5);
  background: var(--el-color-primary-light-9);
  outline: none;
}

.site-overview-features__card > .el-icon {
  grid-row: 1 / span 2;
  color: var(--el-text-color-secondary);
  font-size: 20px;
}

.site-overview-features__card.has-data > .el-icon {
  color: var(--el-color-primary);
}

.site-overview-features__content {
  display: grid;
  min-width: 0;
  gap: 4px;
}

.site-overview-features__content strong,
.site-overview-features__content small,
.site-overview-features__secondary {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.site-overview-features__content small,
.site-overview-features__secondary {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.site-overview-features__value {
  font-size: 20px;
  font-variant-numeric: tabular-nums;
  font-weight: 650;
}

.site-overview-features__secondary {
  grid-column: 2 / -1;
}

@media (max-width: 640px) {
  .site-overview-features {
    padding: 14px;
  }

  .site-overview-features__grid {
    grid-template-columns: 1fr;
  }
}
</style>
