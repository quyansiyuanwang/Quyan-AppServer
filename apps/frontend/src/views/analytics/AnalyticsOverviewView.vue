<template>
  <div class="analytics-page">
    <div class="analytics-toolbar">
      <span class="page-title">数据总览</span>
      <div class="toolbar-right">
        <div class="date-shortcuts">
          <el-button
            v-for="s in dateShortcuts"
            :key="s.label"
            size="small"
            :type="activeShortcut === s.label ? 'primary' : ''"
            @click="applyShortcut(s)"
          >
            {{ s.label }}
          </el-button>
        </div>
        <el-date-picker
          v-model="dateRange"
          type="daterange"
          range-separator="~"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          value-format="x"
          style="width: 280px"
          @change="activeShortcut = ''"
        />
        <el-button type="primary" :loading="loading" @click="loadStats">刷新</el-button>
      </div>
    </div>

    <div class="analytics-content">
      <el-row :gutter="16" class="mb-4">
        <el-col :xs="24" :sm="8">
          <el-card shadow="never">
            <div class="stat-label">总 PV</div>
            <div class="stat-value">{{ totalPv }}</div>
          </el-card>
        </el-col>
        <el-col :xs="24" :sm="8">
          <el-card shadow="never">
            <div class="stat-label">独立会话 (UV)</div>
            <div class="stat-value">{{ stats?.uvCount ?? 0 }}</div>
          </el-card>
        </el-col>
        <el-col :xs="24" :sm="8">
          <el-card shadow="never">
            <div class="stat-label">活跃页面数</div>
            <div class="stat-value">{{ stats?.pvList.length ?? 0 }}</div>
          </el-card>
        </el-col>
      </el-row>

      <el-row :gutter="16" class="mb-4">
        <el-col :xs="24" :lg="16">
          <el-card shadow="never">
            <template #header>PV 趋势</template>
            <div ref="timelineChartEl" style="height: 280px" />
          </el-card>
        </el-col>
        <el-col :xs="24" :lg="8">
          <el-card shadow="never">
            <template #header>热门事件 Top10</template>
            <el-table :data="stats?.topEvents ?? []" size="small" :show-header="true">
              <el-table-column prop="name" label="事件" />
              <el-table-column prop="count" label="次数" width="80" />
            </el-table>
          </el-card>
        </el-col>
      </el-row>

      <el-card shadow="never">
        <template #header>页面 PV 排行</template>
        <el-table :data="stats?.pvList ?? []" size="small">
          <el-table-column prop="page" label="页面路径" />
          <el-table-column prop="count" label="PV" width="100" />
        </el-table>
      </el-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { analyticsService, type TrackStatsResponse } from '@/service/analyticsService'
import { Notification } from '@/utils/notification'
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, TitleComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([LineChart, GridComponent, TooltipComponent, TitleComponent, CanvasRenderer])

const now = Date.now()
const dateRange = ref<[number, number]>([now - 30 * 86400_000, now])
const activeShortcut = ref('30天')
const loading = ref(false)

const dateShortcuts = [
  { label: '今天', days: 0 },
  { label: '7天', days: 7 },
  { label: '30天', days: 30 },
  { label: '90天', days: 90 },
]

function applyShortcut(s: { label: string; days: number }) {
  const end = Date.now()
  const start = s.days === 0 ? new Date().setHours(0, 0, 0, 0) : end - s.days * 86400_000
  dateRange.value = [start, end]
  activeShortcut.value = s.label
  loadStats()
}
const stats = ref<TrackStatsResponse | null>(null)
const timelineChartEl = ref<HTMLElement | null>(null)
let chart: echarts.ECharts | null = null

const totalPv = computed(() => stats.value?.pvList.reduce((s, p) => s + p.count, 0) ?? 0)

async function loadStats() {
  if (!dateRange.value) return
  loading.value = true
  try {
    stats.value = await analyticsService.getStats({
      startTime: dateRange.value[0],
      endTime: dateRange.value[1],
    })
    await nextTick()
    renderTimeline()
  } catch {
    Notification.notify('加载失败', '获取统计数据失败', 'error')
  } finally {
    loading.value = false
  }
}

function renderTimeline() {
  if (!timelineChartEl.value || !stats.value) return
  if (!chart) {
    chart = echarts.init(timelineChartEl.value)
    const onResize = () => chart?.resize()
    window.addEventListener('resize', onResize)
  }
  chart.setOption({
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: stats.value.timeline.map((t) => t.date) },
    yAxis: { type: 'value' },
    series: [{ type: 'line', data: stats.value.timeline.map((t) => t.count), smooth: true }],
  })
}

onMounted(loadStats)

onUnmounted(() => {
  chart?.dispose()
  chart = null
})
</script>

<style scoped>
.analytics-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.analytics-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.page-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.analytics-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
}

.stat-label {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  margin-bottom: 6px;
}

.stat-value {
  font-size: 28px;
  font-weight: 700;
  color: var(--el-text-color-primary);
}
</style>
