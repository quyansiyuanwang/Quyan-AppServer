<template>
  <div class="analytics-page">
    <div class="analytics-toolbar">
      <span class="page-title">热力图</span>
      <div class="toolbar-right">
        <el-select
          v-model="targetPage"
          filterable
          allow-create
          clearable
          placeholder="选择或输入页面路径"
          style="width: 240px"
          :loading="pagesLoading"
        >
          <el-option v-for="p in pageOptions" :key="p" :label="p" :value="p" />
        </el-select>
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
          style="width: 260px"
          @change="activeShortcut = ''"
        />
        <el-radio-group v-model="pointType">
          <el-radio-button value="click">点击热力</el-radio-button>
          <el-radio-button value="scroll_stop">滚动停留</el-radio-button>
        </el-radio-group>
        <el-button type="primary" :loading="loading" @click="loadHeatmap">查询</el-button>
      </div>
    </div>

    <div class="analytics-content">
      <el-card shadow="never">
        <div ref="wrapEl" class="heatmap-wrap">
          <iframe
            v-if="targetPage"
            ref="iframeEl"
            :src="targetPage"
            class="heatmap-iframe"
            sandbox="allow-same-origin allow-scripts"
            @load="onIframeLoad"
          />
          <div v-else class="heatmap-empty">请选择或输入页面路径并点击查询</div>
          <canvas ref="canvasEl" class="heatmap-overlay" />
        </div>
        <div class="heatmap-footer">共 {{ pointCount }} 个热力点</div>
      </el-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, nextTick } from 'vue'
import { analyticsService, type AggregatedHeatPoint } from '@/service/analyticsService'
import { Notification } from '@/utils/notification'

const now = Date.now()
const targetPage = ref('')
const dateRange = ref<[number, number]>([now - 7 * 86400_000, now])
const activeShortcut = ref('7天')
const pointType = ref<'click' | 'scroll_stop'>('click')
const loading = ref(false)
const pagesLoading = ref(false)
const pointCount = ref(0)
const wrapEl = ref<HTMLElement | null>(null)
const canvasEl = ref<HTMLCanvasElement | null>(null)
const iframeEl = ref<HTMLIFrameElement | null>(null)
const pageOptions = ref<string[]>([])
let refWidth = 1440

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

function getRefWidth(): number {
  const wrap = wrapEl.value
  if (!wrap) return 1440
  return Math.max(wrap.clientWidth, 1440)
}

function scaleIframe() {
  const iframe = iframeEl.value
  const wrap = wrapEl.value
  if (!iframe || !wrap) return
  refWidth = getRefWidth()
  const containerW = wrap.clientWidth
  const containerH = wrap.clientHeight
  const scale = containerW / refWidth
  iframe.style.width = `${refWidth}px`
  iframe.style.height = `${containerH / scale}px`
  iframe.style.transform = `scale(${scale})`
  iframe.style.transformOrigin = 'top left'
}

function onIframeLoad() {
  scaleIframe()
}

watch(targetPage, () => {
  if (targetPage.value) nextTick(scaleIframe)
})

async function loadPageOptions() {
  pagesLoading.value = true
  try {
    const res = await analyticsService.getStats({
      startTime: now - 90 * 86400_000,
      endTime: now,
    })
    pageOptions.value = res.pvList.map((p) => p.page)
  } catch {
    // non-blocking
  } finally {
    pagesLoading.value = false
  }
}

async function loadHeatmap() {
  if (!targetPage.value || !dateRange.value) return
  loading.value = true
  try {
    const res = await analyticsService.queryHeatmap({
      page: targetPage.value,
      pointType: pointType.value,
      startTime: dateRange.value[0],
      endTime: dateRange.value[1],
    })
    pointCount.value = res.points.length
    scaleIframe()
    renderHeatmap(res.points)
  } catch {
    Notification.notify('加载失败', '获取热力图数据失败', 'error')
  } finally {
    loading.value = false
  }
}

function renderHeatmap(points: AggregatedHeatPoint[]) {
  const canvas = canvasEl.value
  const wrap = wrapEl.value
  if (!canvas || !wrap) return

  const W = wrap.clientWidth
  const H = wrap.clientHeight
  canvas.width = W
  canvas.height = H
  canvas.style.left = '0'
  canvas.style.top = '0'

  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, W, H)

  if (points.length === 0) return

  const max = Math.max(...points.map((p) => p.count))
  const radius = Math.max(30, Math.min(60, W * 0.05))

  for (const p of points) {
    const x = p.xRatio * W
    const y = p.yRatio * H
    const intensity = p.count / max

    const grad = ctx.createRadialGradient(x, y, 0, x, y, radius)
    grad.addColorStop(0, `rgba(255, 0, 0, ${0.7 * intensity})`)
    grad.addColorStop(0.4, `rgba(255, 100, 0, ${0.4 * intensity})`)
    grad.addColorStop(1, 'rgba(255, 0, 0, 0)')

    ctx.beginPath()
    ctx.fillStyle = grad
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.fill()
  }
}

onMounted(loadPageOptions)
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
  flex-wrap: wrap;
  gap: 10px;
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
  flex-wrap: wrap;
  gap: 10px;
}

.date-shortcuts {
  display: flex;
  gap: 4px;
}

.analytics-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
}

.heatmap-wrap {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  max-height: 640px;
  overflow: hidden;
  background: #f5f5f5;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
}

.heatmap-iframe {
  width: 100%;
  height: 100%;
  border: none;
  pointer-events: none;
  transform-origin: top left;
}

.heatmap-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 10;
}

.heatmap-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  color: var(--el-text-color-placeholder);
  font-size: 14px;
}

.heatmap-footer {
  margin-top: 8px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
</style>
