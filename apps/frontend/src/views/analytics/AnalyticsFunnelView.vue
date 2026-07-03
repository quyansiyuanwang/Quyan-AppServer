<template>
  <div class="analytics-page">
    <div class="analytics-toolbar">
      <span class="page-title">漏斗分析</span>
    </div>

    <div class="analytics-content">
      <el-card shadow="never" class="mb-4">
        <template #header>分析配置</template>
        <div class="funnel-filters">
          <div class="filter-steps">
            <div class="filter-label">漏斗步骤（至少2个）</div>
            <div class="steps-list">
              <div v-for="(step, index) in steps" :key="step.id" class="step-item">
                <span class="step-index">{{ index + 1 }}</span>
                <el-autocomplete
                  v-model="step.name"
                  :fetch-suggestions="queryEvents"
                  placeholder="事件名，如 page_view"
                  size="small"
                  style="flex: 1"
                  clearable
                  value-key="value"
                />
                <el-button-group size="small">
                  <el-button :disabled="index === 0" :icon="ArrowUp" @click="moveStep(index, -1)" />
                  <el-button
                    :disabled="index === steps.length - 1"
                    :icon="ArrowDown"
                    @click="moveStep(index, 1)"
                  />
                </el-button-group>
                <el-button
                  type="danger"
                  text
                  :icon="Close"
                  size="small"
                  :disabled="steps.length <= 2"
                  @click="removeStep(index)"
                />
              </div>
            </div>
            <el-button
              type="primary"
              plain
              :icon="Plus"
              size="small"
              style="margin-top: 8px"
              @click="addStep"
            >
              添加步骤
            </el-button>
          </div>

          <div class="filter-date">
            <div class="filter-label">时间范围</div>
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
              style="margin-top: 8px"
              @change="activeShortcut = ''"
            />
          </div>

          <div class="filter-action">
            <el-button type="primary" :loading="loading" @click="loadFunnel">分析</el-button>
          </div>
        </div>
      </el-card>

      <el-card v-if="funnelData.length > 0" shadow="never">
        <template #header>转化漏斗</template>
        <el-row :gutter="16">
          <el-col :xs="24" :lg="14">
            <div ref="funnelChartEl" style="height: 360px" />
          </el-col>
          <el-col :xs="24" :lg="10">
            <el-table :data="funnelData" size="small">
              <el-table-column prop="name" label="步骤" />
              <el-table-column prop="users" label="用户数" width="90" />
              <el-table-column label="转化率" width="90">
                <template #default="{ row }">{{ row.rate }}%</template>
              </el-table-column>
            </el-table>
          </el-col>
        </el-row>
      </el-card>

      <el-empty v-else-if="!loading" description="请添加至少2个步骤后点击分析" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, onMounted, onUnmounted } from 'vue'
import { Plus, Close, ArrowUp, ArrowDown } from '@element-plus/icons-vue'
import { analyticsService, type FunnelStep } from '@/service/analyticsService'
import { Notification } from '@/utils/notification'
import * as echarts from 'echarts/core'
import { FunnelChart } from 'echarts/charts'
import { TooltipComponent, LegendComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([FunnelChart, TooltipComponent, LegendComponent, CanvasRenderer])

interface StepItem {
  id: number
  name: string
}

let stepIdCounter = 0
const now = Date.now()
const steps = ref<StepItem[]>([
  { id: stepIdCounter++, name: '' },
  { id: stepIdCounter++, name: '' },
])
const dateRange = ref<[number, number]>([now - 7 * 86400_000, now])
const activeShortcut = ref('7天')
const loading = ref(false)
const funnelData = ref<FunnelStep[]>([])
const funnelChartEl = ref<HTMLElement | null>(null)
let chart: echarts.ECharts | null = null

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
}

function addStep() {
  steps.value.push({ id: stepIdCounter++, name: '' })
}

function removeStep(index: number) {
  steps.value.splice(index, 1)
}

function moveStep(index: number, direction: -1 | 1) {
  const target = index + direction
  if (target < 0 || target >= steps.value.length) return
  const arr = steps.value
  const tmp = arr[index]!
  arr[index] = arr[target]!
  arr[target] = tmp
}

const eventNames = ref<string[]>([])

async function loadEventNames() {
  try {
    const res = await analyticsService.getStats({
      startTime: Date.now() - 90 * 86400_000,
      endTime: Date.now(),
    })
    eventNames.value = res.topEvents.map((e) => e.name)
  } catch {
    // non-blocking
  }
}

function queryEvents(query: string, cb: (suggestions: { value: string }[]) => void) {
  const results = eventNames.value
    .filter((n) => !query || n.toLowerCase().includes(query.toLowerCase()))
    .map((n) => ({ value: n }))
  cb(results)
}

async function loadFunnel() {
  const validSteps = steps.value.map((s) => s.name.trim()).filter(Boolean)
  if (validSteps.length < 2 || !dateRange.value) return

  loading.value = true
  try {
    const res = await analyticsService.getFunnel({
      steps: validSteps,
      startTime: dateRange.value[0],
      endTime: dateRange.value[1],
    })
    funnelData.value = res.steps
    await nextTick()
    renderFunnel()
  } catch {
    Notification.notify('加载失败', '获取漏斗数据失败', 'error')
  } finally {
    loading.value = false
  }
}

function renderFunnel() {
  if (!funnelChartEl.value) return
  if (!chart) {
    chart = echarts.init(funnelChartEl.value)
    const onResize = () => chart?.resize()
    window.addEventListener('resize', onResize)
  }
  chart.setOption(
    {
      tooltip: { trigger: 'item', formatter: '{b}: {c} 人 ({d}%)' },
      series: [
        {
          type: 'funnel',
          left: '10%',
          width: '80%',
          data: funnelData.value.map((s) => ({ name: s.name, value: s.users })),
        },
      ],
    },
    true,
  )
}

onMounted(loadEventNames)

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
  padding: 12px 20px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.page-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.analytics-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
}

.funnel-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 24px;
}

.filter-label {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  margin-bottom: 8px;
}

.filter-steps {
  min-width: 300px;
}

.steps-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.step-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.step-index {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  width: 16px;
  text-align: center;
  flex-shrink: 0;
}

.filter-date {
  min-width: 260px;
}

.date-shortcuts {
  display: flex;
  gap: 6px;
}

.filter-action {
  padding-top: 28px;
}
</style>
