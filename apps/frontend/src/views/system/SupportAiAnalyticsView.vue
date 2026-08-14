<template>
  <main class="support-analytics" v-loading="loading">
    <header class="support-analytics__header">
      <div>
        <h2>{{ i18ns.t('support.analytics') }}</h2>
        <p>{{ rangeLabel }}</p>
      </div>
      <el-date-picker v-model="range" type="daterange" value-format="YYYY-MM-DD" @change="load" />
    </header>
    <section class="support-analytics__metrics">
      <div>
        <span>{{ i18ns.t('support.analyticsRequests') }}</span
        ><strong>{{ data.totalRequests }}</strong>
      </div>
      <div>
        <span>{{ i18ns.t('support.analyticsTokens') }}</span
        ><strong>{{ data.totalTokens.toLocaleString() }}</strong>
      </div>
      <div>
        <span>{{ i18ns.t('support.analyticsCost') }}</span
        ><strong>{{ data.totalEstimatedCost.toFixed(6) }}</strong>
      </div>
      <div>
        <span>{{ i18ns.t('support.analyticsUsers') }}</span
        ><strong>{{ data.totalUsers }}</strong>
      </div>
    </section>
    <section class="support-analytics__trend" aria-label="usage trend">
      <div
        v-for="point in data.trends"
        :key="point.date"
        class="support-analytics__bar"
        :title="`${point.date}: ${point.totalTokens}`"
      >
        <i :style="{ height: `${barHeight(point.totalTokens)}%` }" />
        <small>{{ point.date.slice(5) }}</small>
      </div>
    </section>
    <el-table :data="data.users" @row-click="openConversation">
      <el-table-column prop="username" label="User" min-width="160" />
      <el-table-column
        prop="requestCount"
        :label="i18ns.t('support.analyticsRequests')"
        width="120"
      />
      <el-table-column prop="inputTokens" label="Input" width="130" />
      <el-table-column prop="outputTokens" label="Output" width="130" />
      <el-table-column prop="totalTokens" :label="i18ns.t('support.analyticsTokens')" width="150" />
      <el-table-column :label="i18ns.t('support.analyticsCost')" width="150"
        ><template #default="{ row }">{{ row.estimatedCost.toFixed(6) }}</template></el-table-column
      >
      <el-table-column prop="lastRequestAt" label="Last request" min-width="180" />
    </el-table>
    <el-pagination
      v-model:current-page="page"
      :page-size="20"
      :total="data.totalUsers"
      layout="prev, pager, next"
      @current-change="load"
    />
    <el-dialog
      v-model="conversationOpen"
      :title="i18ns.t('support.analyticsConversation')"
      width="min(680px, calc(100vw - 32px))"
    >
      <div class="support-analytics__conversation">
        <article v-for="(message, index) in conversation" :key="index" :class="message.role">
          <MarkdownRenderer v-if="message.role === 'assistant'" :content="message.content" variant="chat" />
          <template v-else>{{ message.content }}</template>
        </article>
        <el-empty v-if="!conversation.length" />
      </div>
    </el-dialog>
  </main>
</template>
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { i18ns } from '@/locales'
import { useRequestStore } from '@/stores/request'
import { createSupportControllerApi } from '@/client/services/support-controller.gen'
import MarkdownRenderer from '@/components/common/MarkdownRenderer.vue'
const now = new Date()
const start = new Date(Date.now() - 29 * 86400000)
const range = ref<[string, string]>([
  start.toISOString().slice(0, 10),
  now.toISOString().slice(0, 10),
])
const page = ref(1)
const loading = ref(false)
const conversationOpen = ref(false)
const conversation = ref<Array<{ role: 'user' | 'assistant'; content: string }>>([])
const data = ref<any>({
  totalRequests: 0,
  totalTokens: 0,
  totalEstimatedCost: 0,
  totalUsers: 0,
  trends: [],
  users: [],
})
const api = () => createSupportControllerApi(useRequestStore().getAxios())
const unwrap = (value: any) => value?.data?.data ?? value?.data ?? value
const rangeLabel = computed(() => `${range.value[0]} - ${range.value[1]}`)
const load = async () => {
  loading.value = true
  try {
    data.value = unwrap(
      await api().analytics({
        params: { page: page.value, pageSize: 20, startAt: range.value[0], endAt: range.value[1] },
      }),
    )
  } finally {
    loading.value = false
  }
}
const barHeight = (tokens: number) => {
  const max = Math.max(1, ...data.value.trends.map((item: any) => item.totalTokens))
  return Math.max(4, Math.round((tokens / max) * 100))
}
const openConversation = async (row: any) => {
  const result = unwrap(await api().analyticsConversation({ path: { userId: row.userId } }))
  conversation.value = result.messages ?? []
  conversationOpen.value = true
}
onMounted(() => void load())
</script>
<style scoped>
.support-analytics {
  padding: 24px;
  min-height: 100%;
  box-sizing: border-box;
}
.support-analytics__header {
  display: flex;
  justify-content: space-between;
  align-items: end;
  gap: 16px;
  margin-bottom: 20px;
}
.support-analytics h2 {
  margin: 0;
  font-size: 20px;
}
.support-analytics p {
  margin: 6px 0 0;
  color: var(--el-text-color-secondary);
}
.support-analytics__metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 18px;
}
.support-analytics__metrics div {
  border: 1px solid var(--el-border-color);
  padding: 14px;
  border-radius: 6px;
}
.support-analytics__metrics span {
  display: block;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.support-analytics__metrics strong {
  display: block;
  margin-top: 7px;
  font-size: 22px;
}
.support-analytics__trend {
  height: 180px;
  display: flex;
  align-items: end;
  gap: 8px;
  padding: 12px 4px 28px;
  margin-bottom: 18px;
  border-bottom: 1px solid var(--el-border-color);
  overflow-x: auto;
}
.support-analytics__bar {
  height: 100%;
  min-width: 32px;
  display: flex;
  flex-direction: column;
  justify-content: end;
  align-items: center;
  gap: 5px;
}
.support-analytics__bar i {
  width: 18px;
  background: var(--el-color-primary);
  border-radius: 3px 3px 0 0;
}
.support-analytics__bar small {
  font-size: 10px;
  color: var(--el-text-color-secondary);
}
.support-analytics__conversation {
  display: grid;
  gap: 8px;
  max-height: 55vh;
  overflow: auto;
}
.support-analytics__conversation article {
  max-width: 85%;
  padding: 8px 10px;
  border-radius: 6px;
  white-space: pre-wrap;
}
.support-analytics__conversation .user {
  justify-self: end;
  background: var(--el-color-primary-light-8);
}
.support-analytics__conversation .assistant {
  background: var(--el-fill-color-light);
}
@media (max-width: 760px) {
  .support-analytics {
    padding: 16px;
  }
  .support-analytics__header {
    align-items: stretch;
    flex-direction: column;
  }
  .support-analytics__metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
