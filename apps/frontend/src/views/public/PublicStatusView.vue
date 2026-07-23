<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { CircleCheckFilled, CircleCloseFilled, Refresh } from '@element-plus/icons-vue'
import { useRoute } from 'vue-router'
import type { PublicStatusPage } from '@/service/publicStatusService'
import { publicStatusService } from '@/service/publicStatusService'

const route = useRoute()
const slug = computed(() => (route.params as { slug?: string }).slug ?? '')
const loading = ref(true)
const error = ref('')
const page = ref<PublicStatusPage | null>(null)

const isOperational = computed(
  () => Boolean(page.value?.statusMonitors.length) && page.value!.statusMonitors.every((item) => item.lastStatus === 'up'),
)

const formatAvailability = (value: number) => `${(value * 100).toFixed(1)}%`
const formatDate = (value?: string) => (value ? new Date(value).toLocaleString() : '尚未检测')

const load = async () => {
  loading.value = true
  error.value = ''
  try {
    page.value = await publicStatusService.getStatus(slug.value)
  } catch {
    error.value = '暂时无法加载状态信息。'
  } finally {
    loading.value = false
  }
}

onMounted(() => void load())
</script>

<template>
  <main class="public-status-page">
    <section v-if="loading" class="status-shell" aria-busy="true">
      <el-skeleton :rows="8" animated />
    </section>

    <section v-else-if="error" class="status-shell status-error">
      <h1>状态页不可用</h1>
      <p>{{ error }}</p>
      <el-button :icon="Refresh" @click="load">重新加载</el-button>
    </section>

    <template v-else-if="page">
      <header class="status-hero" :class="{ 'is-incident': !isOperational }">
        <div class="status-shell hero-content">
          <p class="status-kicker">SERVICE STATUS</p>
          <h1>{{ page.name }}</h1>
          <div class="overall-state">
            <component :is="isOperational ? CircleCheckFilled : CircleCloseFilled" :size="24" />
            <strong>{{ isOperational ? '所有服务运行正常' : '部分服务异常' }}</strong>
          </div>
        </div>
      </header>

      <section class="status-shell monitor-list" aria-label="服务状态">
        <article v-for="monitor in page.statusMonitors" :key="monitor.name" class="monitor-row">
          <div class="monitor-summary">
            <span class="state-dot" :class="monitor.lastStatus === 'up' ? 'is-up' : 'is-down'" />
            <div>
              <h2>{{ monitor.name }}</h2>
              <p>最近检测于 {{ formatDate(monitor.lastCheckedAt) }}</p>
            </div>
          </div>
          <div class="monitor-metrics">
            <div>
              <span>可用率</span>
              <strong>{{ formatAvailability(monitor.availability || 0) }}</strong>
            </div>
            <div>
              <span>最近延迟</span>
              <strong>{{ monitor.checks[0] ? `${monitor.checks[0].latencyMs} ms` : '-' }}</strong>
            </div>
            <div>
              <span>状态码</span>
              <strong>{{ monitor.checks[0]?.statusCode ?? '-' }}</strong>
            </div>
          </div>
          <div class="history-strip" aria-label="最近检测历史">
            <span
              v-for="check in [...monitor.checks].reverse()"
              :key="check.checkedAt"
              class="history-mark"
              :class="check.checkStatus === 'up' ? 'is-up' : 'is-down'"
              :title="`${formatDate(check.checkedAt)} · ${check.statusCode} · ${check.latencyMs} ms`"
            />
            <span v-if="!monitor.checks.length" class="history-empty">尚无检测记录</span>
          </div>
        </article>
      </section>
    </template>
  </main>
</template>

<style scoped>
.public-status-page {
  min-height: 100vh;
  background: #f4f7f5;
  color: #17221e;
}
.status-shell {
  width: min(920px, calc(100% - 40px));
  margin: 0 auto;
}
.status-hero {
  padding: 76px 0 58px;
  background: #0d5b4d;
  color: #f8fffb;
}
.status-hero.is-incident {
  background: #a33a2f;
}
.status-kicker {
  margin: 0 0 12px;
  font: 600 12px ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: 1px;
  opacity: 0.78;
}
.status-hero h1 {
  margin: 0;
  font-size: 34px;
  font-weight: 700;
  letter-spacing: 0;
}
.overall-state {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 22px;
  font-size: 17px;
}
.monitor-list {
  display: grid;
  gap: 14px;
  padding: 34px 0 52px;
}
.monitor-row {
  display: grid;
  grid-template-columns: minmax(230px, 1fr) auto;
  gap: 22px;
  padding: 24px;
  background: #fff;
  border: 1px solid #dbe5df;
  border-radius: 6px;
}
.monitor-summary {
  display: flex;
  gap: 13px;
  align-items: flex-start;
}
.state-dot {
  width: 11px;
  height: 11px;
  flex: 0 0 auto;
  margin-top: 6px;
  border-radius: 50%;
}
.is-up {
  background: #1a9b69;
}
.is-down {
  background: #cf5045;
}
.monitor-summary h2 {
  margin: 0;
  font-size: 18px;
}
.monitor-summary p,
.history-empty {
  margin: 6px 0 0;
  color: #607069;
  font-size: 13px;
}
.monitor-metrics {
  display: flex;
  gap: 28px;
  text-align: right;
}
.monitor-metrics div {
  display: grid;
  gap: 5px;
}
.monitor-metrics span {
  color: #607069;
  font-size: 12px;
}
.monitor-metrics strong {
  font-variant-numeric: tabular-nums;
}
.history-strip {
  grid-column: 1 / -1;
  display: flex;
  gap: 4px;
  min-height: 8px;
}
.history-mark {
  width: 100%;
  max-width: 32px;
  height: 8px;
  border-radius: 2px;
}
.status-error {
  display: grid;
  place-items: start;
  gap: 12px;
  padding-top: 20vh;
}
.status-error h1,
.status-error p {
  margin: 0;
}
@media (max-width: 680px) {
  .status-shell {
    width: min(100% - 28px, 920px);
  }
  .status-hero {
    padding: 54px 0 40px;
  }
  .status-hero h1 {
    font-size: 27px;
  }
  .monitor-row {
    grid-template-columns: 1fr;
    gap: 18px;
    padding: 19px;
  }
  .monitor-metrics {
    justify-content: space-between;
    text-align: left;
    gap: 8px;
  }
}
</style>
