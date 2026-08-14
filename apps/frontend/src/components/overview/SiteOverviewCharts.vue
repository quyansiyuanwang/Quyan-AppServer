<template>
  <section v-if="charts.length" class="site-overview-charts" aria-live="polite">
    <el-card
      v-for="chart in charts"
      :key="chart.id"
      class="site-overview-charts__panel"
      :class="{ 'is-wide': chart.kind !== 'donut' }"
      shadow="never"
    >
      <template #header>
        <div class="site-overview-charts__header">
          <span>{{ chart.title }}</span>
          <el-tag size="small" effect="plain">{{
            chart.items?.length || chart.categories?.length || 0
          }}</el-tag>
        </div>
      </template>
      <AsyncVChart class="site-overview-charts__canvas" autoresize :option="optionFor(chart)" />
    </el-card>
  </section>
</template>

<script setup lang="ts">
import type { SiteOverviewChart } from '@/composables/useSiteOverview'
import { AsyncVChart } from '@/utils/asyncChart'

const props = defineProps<{
  charts: readonly SiteOverviewChart[]
}>()

const palette = ['#2563eb', '#0f766e', '#d97706', '#be123c', '#6d28d9', '#0f766e']

const optionFor = (chart: SiteOverviewChart): Record<string, unknown> => {
  if (chart.kind === 'donut') {
    return {
      color: palette,
      tooltip: { trigger: 'item', valueFormatter: (value: number) => String(value) },
      legend: { bottom: 0, type: 'scroll' },
      series: [
        {
          type: 'pie',
          radius: ['48%', '74%'],
          center: ['50%', '44%'],
          avoidLabelOverlap: true,
          label: { show: false },
          emphasis: { label: { show: true, fontSize: 13, fontWeight: 600 } },
          data: chart.items?.map((item) => ({ name: item.label, value: item.value })) || [],
        },
      ],
    }
  }

  return {
    color: palette,
    tooltip: { trigger: 'axis' },
    legend: { bottom: 0, type: 'scroll' },
    grid: { top: 20, right: 20, bottom: 48, left: 42, containLabel: false },
    xAxis: {
      type: 'category',
      boundaryGap: chart.kind === 'bar',
      data: chart.categories || [],
      axisLabel: { hideOverlap: true },
    },
    yAxis: { type: 'value', minInterval: 1 },
    series:
      chart.series?.map((series) => ({
        name: series.label,
        type: chart.kind,
        smooth: chart.kind === 'line',
        symbol: chart.kind === 'line' ? 'circle' : undefined,
        barMaxWidth: chart.kind === 'bar' ? 28 : undefined,
        data: series.values,
      })) || [],
  }
}
</script>

<style scoped>
.site-overview-charts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.site-overview-charts__panel {
  min-width: 0;
  border-color: var(--el-border-color-lighter);
}

.site-overview-charts__panel.is-wide {
  grid-column: 1 / -1;
}

.site-overview-charts__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-weight: 600;
}

.site-overview-charts__canvas {
  width: 100%;
  height: 300px;
}

@media (max-width: 760px) {
  .site-overview-charts {
    grid-template-columns: 1fr;
  }

  .site-overview-charts__panel.is-wide {
    grid-column: auto;
  }

  .site-overview-charts__canvas {
    height: 260px;
  }
}
</style>
