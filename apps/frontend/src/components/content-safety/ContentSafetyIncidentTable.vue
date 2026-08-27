<template>
  <div class="incident-table">
    <div class="incident-toolbar">
      <el-input
        v-if="props.scope === 'system'"
        v-model="filters.userId"
        clearable
        :placeholder="t('contentSafety.userIdFilter')"
        @keyup.enter="reload"
      />
      <el-date-picker
        v-model="filters.timeRange"
        type="daterange"
        value-format="YYYY-MM-DDTHH:mm:ss.SSSZ"
        :start-placeholder="t('contentSafety.startTime')"
        :end-placeholder="t('contentSafety.endTime')"
        @change="reload"
      />
      <el-input
        v-model="filters.requestId"
        clearable
        :placeholder="t('contentSafety.requestId')"
        @keyup.enter="reload"
      />
      <el-input
        v-model="filters.relayTokenName"
        clearable
        :placeholder="t('contentSafety.tokenName')"
        @keyup.enter="reload"
      />
      <el-input
        v-model="filters.channelName"
        clearable
        :placeholder="t('contentSafety.channelName')"
        @keyup.enter="reload"
      />
      <el-select
        v-model="filters.direction"
        clearable
        :placeholder="t('contentSafety.direction')"
        @change="reload"
      >
        <el-option :label="t('contentSafety.request')" value="request" /><el-option
          :label="t('contentSafety.response')"
          value="response"
        />
      </el-select>
      <el-select
        v-model="filters.source"
        clearable
        :placeholder="t('contentSafety.source')"
        @change="reload"
      >
        <el-option label="rule" value="rule" /><el-option label="AI" value="ai" />
      </el-select>
      <el-select
        v-model="filters.processingStatus"
        clearable
        :placeholder="t('contentSafety.processingStatus')"
        @change="reload"
      >
        <el-option :label="t('contentSafety.statusAllow')" value="allow" /><el-option
          :label="t('contentSafety.statusReplaced')"
          value="replaced"
        /><el-option :label="t('contentSafety.statusBlocked')" value="blocked" />
      </el-select>
      <el-button type="primary" @click="reload">{{ t('contentSafety.filter') }}</el-button>
      <el-popover placement="bottom-end" :width="260" trigger="click">
        <template #reference
          ><el-button>{{ t('contentSafety.columnSettings') }}</el-button></template
        >
        <el-checkbox-group v-model="visibleColumns" class="column-settings">
          <el-checkbox v-for="column in columns" :key="column.key" :label="column.key">{{
            column.label
          }}</el-checkbox>
        </el-checkbox-group>
      </el-popover>
    </div>
    <el-table v-loading="loading" :data="incidents" border stripe @sort-change="handleSort">
      <el-table-column
        v-for="column in visibleColumnDefs"
        :key="column.key"
        :label="column.label"
        :prop="column.prop"
        :min-width="column.width"
        :sortable="column.sortable ? 'custom' : false"
      >
        <template #default="{ row }">
          <template v-if="column.key === 'time'"
            ><el-tooltip :content="new Date(row.createTime).toISOString()"
              ><span>{{ formatTime(row.createTime) }}</span></el-tooltip
            ></template
          >
          <template v-else-if="column.key === 'requestId'"
            ><span class="copy-cell"
              ><span class="mono">{{ row.requestId || '-' }}</span
              ><el-button v-if="row.requestId" link size="small" @click="copy(row.requestId)"
                >⧉</el-button
              ></span
            ></template
          >
          <template v-else-if="column.key === 'context'"
            ><span class="matched-context" v-html="formatContext(row)"
          /></template>
          <template v-else-if="column.key === 'status'"
            ><el-tag :type="statusType(row)">{{ statusLabel(row) }}</el-tag></template
          >
          <template v-else-if="column.key === 'action'">{{ actionLabel(row.action) }}</template>
          <template v-else>{{
            column.value ? column.value(row) : column.path ? get(row, column.path) : '-'
          }}</template>
        </template>
      </el-table-column>
    </el-table>
    <el-pagination
      v-model:current-page="page"
      v-model:page-size="pageSize"
      :total="total"
      layout="prev, pager, next, sizes"
      @current-change="load"
      @size-change="load"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { i18ns } from '@/locales'
import { useRequestStore } from '@/stores/request'
import { createContentSafetyControllerApi } from '@/client/services/content-safety-controller.gen'
import { copyTextWithFallback } from '@/utils/clipboard'
import { TypedLocalStorage } from '@/utils/typedLocalStorage'

const props = withDefaults(defineProps<{ scope?: 'system' | 'user' }>(), { scope: 'user' })
const t = (key: any) => i18ns.t(key)
const api = () => createContentSafetyControllerApi(useRequestStore().getAxios()) as any
const unwrap = (v: any) => v?.data?.data ?? v?.data ?? v
const storageKey = computed(() => `content-safety-incidents-columns:${props.scope}`)
type IncidentColumn = {
  key: string
  label: string
  prop?: string
  path?: string
  width: number
  sortable?: boolean
  value?: (row: any) => string
}
const columns: IncidentColumn[] = [
  { key: 'time', label: t('contentSafety.time'), prop: 'createTime', width: 160, sortable: true },
  { key: 'direction', label: t('contentSafety.direction'), prop: 'direction', width: 100 },
  { key: 'action', label: t('contentSafety.action'), prop: 'action', width: 110 },
  { key: 'source', label: t('contentSafety.source'), prop: 'source', width: 100 },
  {
    key: 'requestId',
    label: t('contentSafety.requestId'),
    prop: 'requestId',
    width: 190,
    sortable: true,
  },
  { key: 'tokenName', label: t('contentSafety.tokenName'), path: 'relayTokenName', width: 150 },
  { key: 'channelName', label: t('contentSafety.channelName'), path: 'channelName', width: 150 },
  {
    key: 'rule',
    label: t('contentSafety.triggerRule'),
    value: (r: any) => r.rule?.name || '-',
    width: 150,
  },
  {
    key: 'type',
    label: t('contentSafety.type'),
    value: (r: any) => r.rule?.type || (r.source === 'ai' ? 'AI' : '-'),
    width: 90,
  },
  { key: 'tokenId', label: t('contentSafety.tokenId'), path: 'relayTokenId', width: 160 },
  { key: 'channelId', label: t('contentSafety.channelId'), path: 'channelId', width: 140 },
  { key: 'context', label: t('contentSafety.matchedContext'), width: 360 },
  { key: 'status', label: t('contentSafety.processingStatus'), width: 100 },
  {
    key: 'statusCode',
    label: t('contentSafety.statusCode'),
    path: 'statusCode',
    width: 100,
    sortable: true,
  },
  {
    key: 'auditTokens',
    label: t('contentSafety.auditTokens'),
    path: 'auditTotalTokens',
    width: 110,
  },
  { key: 'auditModel', label: t('contentSafety.auditModel'), path: 'auditModel', width: 130 },
  {
    key: 'auditDuration',
    label: t('contentSafety.auditDuration'),
    path: 'auditDurationMs',
    width: 110,
  },
  { key: 'auditCost', label: t('contentSafety.auditCost'), path: 'auditCost', width: 110 },
  { key: 'userId', label: t('contentSafety.userId'), path: 'userId', width: 150 },
]
const defaults = [
  'time',
  'direction',
  'action',
  'source',
  'requestId',
  'tokenName',
  'context',
  'status',
]
const visibleColumns = ref<string[]>(defaults)
const incidents = ref<any[]>([]),
  total = ref(0),
  loading = ref(false),
  page = ref(1),
  pageSize = ref(20)
const filters = reactive<any>({
  userId: '',
  timeRange: [],
  requestId: '',
  relayTokenName: '',
  channelName: '',
  direction: undefined,
  source: undefined,
  processingStatus: undefined,
})
const sort = reactive({ sortBy: 'createTime', sortOrder: 'desc' as 'asc' | 'desc' })
const visibleColumnDefs = computed(() =>
  columns.filter((column) => visibleColumns.value.includes(column.key)),
)
const get = (row: any, path: string) =>
  path.split('.').reduce((value, key) => value?.[key], row) ?? '-'
const formatTime = (value: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' }).format(
    new Date(value),
  )
const escape = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char] || char,
  )
const formatContext = (row: any) => escape(row.matchContext || row.matchText || t('noData'))
const statusLabel = (row: any) =>
  row.blocked
    ? t('contentSafety.statusBlocked')
    : row.replaced
      ? t('contentSafety.statusReplaced')
      : t('contentSafety.statusAllow')
const statusType = (row: any) => (row.blocked ? 'danger' : row.replaced ? 'warning' : 'success')
const actionLabel = (action: string) =>
  (
    ({
      unreachable: t('contentSafety.unreachable'),
      blackhole: t('contentSafety.blackhole'),
      allow: t('contentSafety.allow'),
    }) as Record<string, string>
  )[action] ||
  action ||
  '-'
const copy = async (value: string) => {
  try {
    if (!(await copyTextWithFallback(value))) throw new Error('copy failed')
    ElMessage.success(t('copySuccess'))
  } catch {
    ElMessage.error(t('copyFailed'))
  }
}
const load = async () => {
  loading.value = true
  try {
    const { timeRange, ...rest } = filters
    const params = {
      page: page.value,
      pageSize: pageSize.value,
      ...rest,
      startTime: timeRange?.[0],
      endTime: timeRange?.[1],
      ...sort,
    }
    const result = unwrap(
      await (props.scope === 'system'
        ? api().listIncidents({ params })
        : api().listUserIncidents({ params })),
    )
    incidents.value = result?.incidents ?? []
    total.value = result?.total ?? 0
  } finally {
    loading.value = false
  }
}
const reload = () => {
  page.value = 1
  void load()
}
const handleSort = ({ prop, order }: any) => {
  if (prop === 'createTime' || prop === 'requestId' || prop === 'statusCode') {
    sort.sortBy = prop
    sort.sortOrder = order === 'ascending' ? 'asc' : 'desc'
    reload()
  }
}
watch(visibleColumns, (value) => TypedLocalStorage.set(storageKey.value, value), {
  deep: true,
})
onMounted(() => {
  try {
    const saved = TypedLocalStorage.get<string[]>(storageKey.value)
    if (Array.isArray(saved) && saved.length) visibleColumns.value = saved
  } catch {
    /* ignore invalid local settings */
  }
  void load()
})
</script>

<style scoped>
.incident-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}
.incident-toolbar .el-input {
  width: 180px;
}
.incident-toolbar .el-select {
  width: 140px;
}
.column-settings {
  display: grid;
  gap: 6px;
  max-height: 340px;
  overflow: auto;
}
.copy-cell {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
}
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
}
.matched-context {
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
