<template>
  <main class="short-link-analytics page-shell" v-loading="loading">
    <header class="analytics-header">
      <div>
        <el-button :icon="ArrowLeft" text @click="router.push({ name: 'product-short_link' })">{{
          t('shortLinkAnalytics.back')
        }}</el-button>
        <h1>{{ t('shortLinkAnalytics.title') }}</h1>
        <p v-if="stats">{{ t('shortLinkAnalytics.description', { code: stats.code }) }}</p>
      </div>
      <el-button :icon="Refresh" :loading="loading" @click="load">{{
        t('shortLinkAnalytics.refresh')
      }}</el-button>
    </header>

    <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
    <template v-else-if="stats">
      <section class="summary-grid">
        <div class="summary-item">
          <span>{{ t('shortLinkAnalytics.totalVisits') }}</span
          ><strong>{{ stats.totalClicks }}</strong>
        </div>
        <div class="summary-item">
          <span>{{ t('shortLinkAnalytics.uniqueIps') }}</span
          ><strong>{{ stats.uniqueVisitors }}</strong>
        </div>
        <div class="summary-item">
          <span>{{ t('shortLinkAnalytics.periodVisits') }}</span
          ><strong>{{ stats.totalRecords }}</strong>
        </div>
        <div class="summary-item">
          <span>{{ t('shortLinkAnalytics.retention') }}</span
          ><strong>{{ t('shortLinkAnalytics.retentionDays') }}</strong>
        </div>
      </section>

      <section class="analytics-section chart-section">
        <div class="section-heading">
          <h2>{{ t('shortLinkAnalytics.dailyTrend') }}</h2>
          <span>{{ stats.periodStart.slice(0, 10) }} - {{ stats.periodEnd.slice(0, 10) }}</span>
        </div>
        <AsyncVChart class="traffic-chart" :option="dailyChartOption" autoresize />
      </section>

      <section class="analytics-section chart-section">
        <div class="section-heading">
          <h2>{{ t('shortLinkAnalytics.hourlyTrend') }}</h2>
          <span>{{ t('shortLinkAnalytics.periodVisits') }}</span>
        </div>
        <AsyncVChart class="traffic-chart" :option="hourlyChartOption" autoresize />
      </section>

      <section class="analytics-grid">
        <div class="analytics-section">
          <div class="section-heading">
            <h2>{{ t('shortLinkAnalytics.ipRanking') }}</h2>
            <span>{{ t('shortLinkAnalytics.topCount', { count: stats.ipAddresses.length }) }}</span>
          </div>
          <el-table :data="stats.ipAddresses" size="small" max-height="340"
            ><el-table-column
              prop="ipAddress"
              :label="t('shortLinkAnalytics.ipAddress')"
              min-width="170"
              ><template #default="{ row }">{{
                row.ipAddress || t('shortLinkAnalytics.unknown')
              }}</template></el-table-column
            ><el-table-column prop="count" :label="t('shortLinkAnalytics.visitCount')" width="100"
          /></el-table>
        </div>
        <div class="analytics-section">
          <div class="section-heading">
            <h2>{{ t('shortLinkAnalytics.sourceRanking') }}</h2>
            <span>{{ t('shortLinkAnalytics.topCount', { count: stats.sources.length }) }}</span>
          </div>
          <el-table :data="stats.sources" size="small" max-height="340"
            ><el-table-column
              prop="sourceHost"
              :label="t('shortLinkAnalytics.sourceHost')"
              min-width="170"
              ><template #default="{ row }">{{
                row.sourceHost || t('shortLinkAnalytics.directVisit')
              }}</template></el-table-column
            ><el-table-column prop="count" :label="t('shortLinkAnalytics.visitCount')" width="100"
          /></el-table>
        </div>
      </section>

      <section class="analytics-section">
        <div class="section-heading">
          <h2>{{ t('shortLinkAnalytics.visitDetails') }}</h2>
          <span>{{ t('shortLinkAnalytics.recordCount', { count: stats.totalRecords }) }}</span>
        </div>
        <el-table :data="stats.recentClicks" stripe
          ><el-table-column :label="t('shortLinkAnalytics.visitTime')" min-width="180"
            ><template #default="{ row }">{{
              formatTime(row.clickedAt)
            }}</template></el-table-column
          ><el-table-column
            prop="ipAddress"
            :label="t('shortLinkAnalytics.ipAddress')"
            min-width="150"
            ><template #default="{ row }">{{
              row.ipAddress || t('shortLinkAnalytics.unknown')
            }}</template></el-table-column
          ><el-table-column prop="country" :label="t('shortLinkAnalytics.region')" width="100"
            ><template #default="{ row }">{{ row.country || '-' }}</template></el-table-column
          ><el-table-column
            prop="sourceHost"
            :label="t('shortLinkAnalytics.source')"
            min-width="150"
            ><template #default="{ row }">{{
              row.sourceHost || t('shortLinkAnalytics.directVisit')
            }}</template></el-table-column
          ><el-table-column
            prop="userAgent"
            :label="t('shortLinkAnalytics.userAgent')"
            min-width="220"
            show-overflow-tooltip
        /></el-table>
        <el-pagination
          v-if="stats.totalRecords > stats.pageSize"
          :current-page="stats.page"
          :page-size="stats.pageSize"
          layout="prev, pager, next"
          :total="stats.totalRecords"
          class="visit-pagination"
          @current-change="changePage"
        />
      </section>
    </template>
  </main>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ArrowLeft, Refresh } from '@element-plus/icons-vue'
import { useRoute, useRouter } from 'vue-router'
import type { DeveloperShortLinkStatsDto } from '@/client/types.gen'
import { i18ns } from '@/locales'
import { developerProductService } from '@/service/developerProductService'
import { AsyncVChart } from '@/utils/asyncChart'
import { getErrorMessage } from '@/utils/error-utils'

const route = useRoute()
const router = useRouter()
const { t } = i18ns
const loading = ref(false)
const error = ref('')
const stats = ref<DeveloperShortLinkStatsDto>()
const page = ref(1)
const analyticsParams = computed(() => route.params as { instanceId?: string; linkId?: string })
const instanceId = computed(() => String(analyticsParams.value.instanceId || ''))
const linkId = computed(() => String(analyticsParams.value.linkId || ''))

const formatTime = (value: string) => new Date(value).toLocaleString()
const dailyChartOption = computed(() => ({
  tooltip: { trigger: 'axis' },
  grid: { top: 24, left: 36, right: 16, bottom: 32 },
  xAxis: { type: 'category', data: stats.value?.clicksByDay.map((item) => item.date) ?? [] },
  yAxis: { type: 'value', minInterval: 1 },
  series: [
    {
      type: 'bar',
      data: stats.value?.clicksByDay.map((item) => item.count) ?? [],
      itemStyle: { color: '#168b67' },
    },
  ],
}))
const hourlyChartOption = computed(() => ({
  tooltip: { trigger: 'axis' },
  grid: { top: 24, left: 36, right: 16, bottom: 32 },
  xAxis: { type: 'category', data: stats.value?.clicksByHour.map((item) => item.hour) ?? [] },
  yAxis: { type: 'value', minInterval: 1 },
  series: [
    {
      type: 'bar',
      data: stats.value?.clicksByHour.map((item) => item.count) ?? [],
      itemStyle: { color: '#d97706' },
    },
  ],
}))

const load = async () => {
  if (!instanceId.value || !linkId.value) return
  loading.value = true
  error.value = ''
  try {
    stats.value = await developerProductService.shortLinkStats(
      instanceId.value,
      linkId.value,
      page.value,
      25,
    )
  } catch (cause) {
    error.value = getErrorMessage(cause, t('shortLinkAnalytics.loadFailed'))
  } finally {
    loading.value = false
  }
}

const changePage = (nextPage: number) => {
  if (page.value === nextPage) return
  page.value = nextPage
  void load()
}

watch(
  [instanceId, linkId],
  () => {
    page.value = 1
    void load()
  },
  { immediate: true },
)
</script>

<style scoped>
.short-link-analytics {
  min-height: 100%;
  padding: 24px;
}
.analytics-header,
.section-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.analytics-header {
  margin-bottom: 20px;
}
.analytics-header h1,
.section-heading h2 {
  margin: 0;
}
.analytics-header p,
.section-heading span {
  margin: 6px 0 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}
.summary-item,
.analytics-section {
  padding: 18px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
}
.summary-item {
  display: grid;
  gap: 8px;
}
.summary-item span {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.summary-item strong {
  font-size: 24px;
  font-variant-numeric: tabular-nums;
}
.analytics-section {
  min-width: 0;
}
.chart-section {
  margin-bottom: 16px;
}
.traffic-chart {
  height: 280px;
  width: 100%;
}
.analytics-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  margin-bottom: 16px;
}
.visit-pagination {
  justify-content: flex-end;
  margin-top: 16px;
}
@media (max-width: 760px) {
  .short-link-analytics {
    padding: 16px;
  }
  .summary-grid,
  .analytics-grid {
    grid-template-columns: 1fr;
  }
  .analytics-header {
    align-items: center;
  }
  .analytics-header h1 {
    font-size: 22px;
  }
}
</style>
