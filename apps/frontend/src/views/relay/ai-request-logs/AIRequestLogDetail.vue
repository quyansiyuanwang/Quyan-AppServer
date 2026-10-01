<template>
  <section class="request-detail">
    <el-alert v-if="metadataError" type="error" :closable="false"
      ><span>{{ metadataError }}</span
      ><el-button link @click="loadMetadata">{{
        i18ns.t('aiRequestLogs.retry')
      }}</el-button></el-alert
    >
    <el-descriptions :column="2" border>
      <el-descriptions-item :label="i18ns.t('aiRequestLogs.user')"
        >{{ identityLabel(metadata)
        }}<code v-if="metadata.userId">{{ metadata.userId }}</code></el-descriptions-item
      >
      <el-descriptions-item :label="i18ns.t('aiRequestLogs.token')"
        >{{ tokenLabel(metadata)
        }}<code v-if="metadata.relayTokenId">{{
          metadata.relayTokenId
        }}</code></el-descriptions-item
      >
      <el-descriptions-item :label="i18ns.t('aiRequestLogs.requestId')"
        ><code>{{ metadata.requestId }}</code></el-descriptions-item
      >
      <el-descriptions-item :label="i18ns.t('aiRequestLogs.authentication')">{{
        authLabel(metadata.authenticationState)
      }}</el-descriptions-item>
      <el-descriptions-item :label="i18ns.t('aiRequestLogs.model')">{{
        metadata.model || i18ns.t('aiRequestLogs.unrecorded')
      }}</el-descriptions-item>
      <el-descriptions-item :label="i18ns.t('aiRequestLogs.format')">{{
        metadata.requestFormat || i18ns.t('aiRequestLogs.unrecorded')
      }}</el-descriptions-item>
      <el-descriptions-item :label="i18ns.t('aiRequestLogs.outcome')"
        >{{ outcomeLabel(metadata.outcome) }} · HTTP {{ metadata.statusCode }}</el-descriptions-item
      >
      <el-descriptions-item :label="i18ns.t('aiRequestLogs.duration')"
        >{{ metadata.durationMs }} ms</el-descriptions-item
      >
      <el-descriptions-item :label="i18ns.t('aiRequestLogs.path')"
        >{{ metadata.method }} {{ metadata.path }}</el-descriptions-item
      >
      <el-descriptions-item :label="i18ns.t('aiRequestLogs.contentSize')"
        >{{ formatBytes(metadata.requestSizeBytes) }} /
        {{ formatBytes(metadata.responseSizeBytes) }}</el-descriptions-item
      >
      <el-descriptions-item :label="i18ns.t('aiRequestLogs.ipAddress')">{{
        metadata.ipAddress
      }}</el-descriptions-item>
      <el-descriptions-item :label="i18ns.t('aiRequestLogs.userAgent')">{{
        metadata.userAgent || i18ns.t('aiRequestLogs.unrecorded')
      }}</el-descriptions-item>
      <el-descriptions-item :label="i18ns.t('aiRequestLogs.flags')"
        >{{ i18ns.t('aiRequestLogs.requestBody') }}:
        {{
          metadata.requestTruncated
            ? i18ns.t('aiRequestLogs.truncatedYes')
            : i18ns.t('aiRequestLogs.truncatedNo')
        }}
        / {{ i18ns.t('aiRequestLogs.responseBody') }}:
        {{
          metadata.responseTruncated
            ? i18ns.t('aiRequestLogs.truncatedYes')
            : i18ns.t('aiRequestLogs.truncatedNo')
        }}</el-descriptions-item
      >
      <el-descriptions-item :label="i18ns.t('aiRequestLogs.time')">{{
        new Date(metadata.createTime).toLocaleString()
      }}</el-descriptions-item>
    </el-descriptions>
    <el-alert
      v-if="metadata.outcome === 'failed' || metadata.outcome === 'interrupted'"
      type="error"
      :closable="false"
      >{{ stageLabel(metadata.failureStage) }} ·
      {{ metadata.errorCode || metadata.errorSummary }}</el-alert
    >
    <el-alert v-if="metadata.bodyOmissionReason" type="info" :closable="false">{{
      omissionLabel(metadata.bodyOmissionReason)
    }}</el-alert>
    <form class="detail-search" @submit.prevent="searchContent()">
      <el-input
        v-model="keyword"
        clearable
        :placeholder="i18ns.t('aiRequestLogs.detailSearch')"
        :maxlength="500"
      />
      <el-select v-model="searchScope" :aria-label="i18ns.t('aiRequestLogs.searchScope')">
        <el-option value="request" :label="i18ns.t('aiRequestLogs.requestSearch')" /><el-option
          value="response"
          :label="i18ns.t('aiRequestLogs.responseSearch')"
        />
        <el-option
          v-if="canReadAttempts"
          value="attempts"
          :label="i18ns.t('aiRequestLogs.attemptSearch')"
        />
      </el-select>
      <el-button native-type="submit" :loading="searchLoading">{{ i18ns.t('search') }}</el-button>
    </form>
    <el-alert v-if="searchError" type="error" :closable="false">{{ searchError }}</el-alert>
    <section v-if="searchResult" class="search-results">
      <header>
        {{ searchResult.total }} {{ i18ns.t('aiRequestLogs.hits')
        }}<el-tag v-if="searchResult.truncated" type="warning">{{
          i18ns.t('aiRequestLogs.truncatedShort')
        }}</el-tag>
      </header>
      <p v-if="!searchResult.items.length">
        {{
          searchResult.omissionReason
            ? omissionLabel(searchResult.omissionReason)
            : i18ns.t('aiRequestLogs.noResults')
        }}
      </p>
      <button
        v-for="(hit, index) in searchResult.items"
        :key="index"
        class="search-hit"
        @click="locate(hit)"
      >
        <code>{{ hit.path }}</code
        ><span
          >{{ hit.excerpt.slice(0, hit.matchStart)
          }}<mark>{{ hit.excerpt.slice(hit.matchStart, hit.matchEnd) }}</mark
          >{{ hit.excerpt.slice(hit.matchEnd) }}</span
        >
      </button>
      <div class="hit-pagination">
        <el-button :disabled="!searchHistory.length || searchLoading" @click="previousHits">{{
          i18ns.t('aiRequestLogs.previousHits')
        }}</el-button
        ><el-button :disabled="!searchResult.hasMore || searchLoading" @click="nextHits">{{
          i18ns.t('aiRequestLogs.nextHits')
        }}</el-button>
      </div>
    </section>
    <el-radio-group v-model="side" class="source-selector"
      ><el-radio-button value="request">{{ i18ns.t('aiRequestLogs.requestBody') }}</el-radio-button
      ><el-radio-button value="response">{{
        i18ns.t('aiRequestLogs.responseBody')
      }}</el-radio-button></el-radio-group
    >
    <el-tabs v-model="view"
      ><el-tab-pane name="parsed" :label="i18ns.t('aiRequestLogs.parsed')" /><el-tab-pane
        name="raw"
        :label="i18ns.t('aiRequestLogs.raw')"
    /></el-tabs>
    <div v-if="focus" class="focus-bar">
      <code>{{ focus.path }}</code
      ><el-button link @click="focus = null">{{ i18ns.t('aiRequestLogs.backToRoot') }}</el-button>
    </div>
    <AIRequestLogReader
      :key="readerKey"
      :id="row.id"
      :side="side"
      :view="focus?.view ?? (focus ? 'raw' : view)"
      :locator="focus?.locator"
      :offset="focus?.offset"
      @inspect="inspect"
      @expand="expand"
    />
    <section ref="attemptsPanel" class="attempts-panel">
      <header>
        <h3>{{ i18ns.t('aiRequestLogs.attempts') }}</h3>
        <el-button
          v-if="canReadAttempts"
          :loading="attemptsLoading"
          @click="loadAttempts(Boolean(attemptsResult))"
          >{{
            attemptsResult?.hasMore
              ? i18ns.t('aiRequestLogs.loadMore')
              : i18ns.t('aiRequestLogs.loadAttempts')
          }}</el-button
        >
      </header>
      <p v-if="!canReadAttempts">{{ i18ns.t('aiRequestLogs.attemptsPermission') }}</p>
      <el-alert v-if="attemptsError" type="error" :closable="false">{{ attemptsError }}</el-alert>
      <el-alert v-if="attemptsResult?.truncated" type="warning" :closable="false">{{
        i18ns.t('aiRequestLogs.attemptTruncated')
      }}</el-alert>
      <p v-if="attemptsResult && !attemptsResult.items.length">
        {{ i18ns.t('aiRequestLogs.noAttempts') }}
      </p>
      <article
        v-for="attempt in attemptsResult?.items ?? []"
        :key="attempt.sequence"
        class="attempt-row"
        :data-sequence="attempt.sequence"
        :class="{ 'focused-attempt': attemptFocus === attempt.sequence }"
      >
        <strong>#{{ attempt.sequence }} · {{ stageLabel(attempt.stage) }}</strong
        ><span
          >{{
            attempt.success ? i18ns.t('aiRequestLogs.success') : i18ns.t('aiRequestLogs.failed')
          }}
          · HTTP {{ attempt.statusCode ?? '—' }} · {{ attempt.durationMs ?? '—' }} ms</span
        >
        <details v-if="attempt.errorExcerpt" :open="attemptFocus === attempt.sequence">
          <summary>{{ i18ns.t('aiRequestLogs.errorSummary') }}</summary>
          <pre>{{ attempt.errorExcerpt }}</pre>
        </details>
      </article>
    </section>
  </section>
</template>
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import type {
  AiRequestLogAttemptsPageDto,
  AiRequestLogContentItemDto,
  AiRequestLogContentSide,
  AiRequestLogContentView,
  AiRequestLogListItemDto,
  AiRequestLogMetadataDto,
  AiRequestLogSearchHitDto,
  AiRequestLogSearchPageDto,
} from '@/client/types.gen'
import { Permission } from '@quyan/shared'
import { usePermissionStore } from '@/stores/permissionStore'
import { aiRequestLogService } from '@/service/aiRequestLogService'
import { i18ns } from '@/locales'
import { getErrorMessage } from '@/utils/error-utils'
import AIRequestLogReader from './AIRequestLogReader.vue'
import {
  authLabel,
  formatBytes,
  identityLabel,
  omissionLabel,
  outcomeLabel,
  stageLabel,
  tokenLabel,
} from './logPresentation'
const props = defineProps<{ row: AiRequestLogListItemDto }>()
const permissions = usePermissionStore()
const canReadAttempts = computed(() =>
  permissions.hasPermission(Permission.RELAY_REQUEST_DIAGNOSTICS_READ),
)
const metadata = shallowRef<AiRequestLogListItemDto | AiRequestLogMetadataDto>(props.row)
const metadataError = ref('')
const side = ref<AiRequestLogContentSide>('request')
const view = ref<AiRequestLogContentView>('parsed')
const focus = shallowRef<{
  locator: string
  path: string
  offset: number
  view?: AiRequestLogContentView
} | null>(null)
const readerKey = computed(() =>
  [props.row.id, side.value, view.value, focus.value?.locator ?? '', focus.value?.offset ?? 0].join(
    ':',
  ),
)
const keyword = ref('')
const searchScope = ref<AiRequestLogContentSide | 'attempts'>('request')
const searchResult = shallowRef<AiRequestLogSearchPageDto | null>(null)
const searchLoading = ref(false)
const searchError = ref('')
const searchHistory = ref<Array<string | undefined>>([])
let currentSearchCursor: string | undefined
let searchController: AbortController | null = null
let metadataController: AbortController | null = null
let attemptsController: AbortController | null = null
const attemptsResult = shallowRef<AiRequestLogAttemptsPageDto | null>(null)
const attemptsLoading = ref(false)
const attemptsError = ref('')
const loadMetadata = async () => {
  metadataController?.abort()
  metadataController = new AbortController()
  const signal = metadataController.signal
  metadataError.value = ''
  try {
    const result = await aiRequestLogService.metadata(props.row.id, signal)
    if (!signal.aborted) metadata.value = result
  } catch (cause) {
    if (!signal.aborted)
      metadataError.value = getErrorMessage(cause, i18ns.t('aiRequestLogs.detailLoadFailed'))
  }
}
const searchContent = async (cursor?: string) => {
  searchController?.abort()
  searchController = new AbortController()
  const signal = searchController.signal
  const text = keyword.value.trim()
  if (!text) {
    searchResult.value = null
    searchLoading.value = false
    return
  }
  if (!cursor) searchHistory.value = []
  currentSearchCursor = cursor
  searchLoading.value = true
  searchError.value = ''
  try {
    const result = await aiRequestLogService.search(
      props.row.id,
      { keyword: text, scope: searchScope.value, cursor },
      signal,
    )
    if (!signal.aborted) searchResult.value = result
  } catch (cause) {
    if (!signal.aborted)
      searchError.value = getErrorMessage(cause, i18ns.t('aiRequestLogs.searchFailed'))
  } finally {
    if (!signal.aborted) searchLoading.value = false
  }
}
const nextHits = () => {
  if (searchResult.value?.nextCursor) {
    searchHistory.value.push(currentSearchCursor)
    void searchContent(searchResult.value.nextCursor)
  }
}
const previousHits = () => {
  const history = [...searchHistory.value]
  const cursor = history.pop()
  void searchContent(cursor)
  searchHistory.value = history
}
const locate = (hit: AiRequestLogSearchHitDto) => {
  if (hit.side === 'attempts') {
    void locateAttempt(hit)
    return
  }
  side.value = hit.side
  view.value = 'raw'
  focus.value = { locator: hit.locator, path: hit.path, offset: hit.offset }
}
const inspect = (item: AiRequestLogContentItemDto) => {
  view.value = 'raw'
  focus.value = { locator: item.locator, path: item.path, offset: 0 }
}
const expand = (item: AiRequestLogContentItemDto) => {
  view.value = 'parsed'
  focus.value = { locator: item.locator, path: item.path, offset: 0, view: 'parsed' }
}
const attemptFocus = ref<number | null>(null)
const locateAttempt = async (hit: AiRequestLogSearchHitDto) => {
  const match = hit.path.match(/^\/(\d+)(?:\/|$)/)
  if (!match || !canReadAttempts.value || attemptsLoading.value) return
  const sequence = Number(match[1]) + 1
  const id = props.row.id
  if (!attemptsResult.value) await loadAttempts()
  while (
    props.row.id === id &&
    canReadAttempts.value &&
    attemptsResult.value?.hasMore &&
    !attemptsError.value &&
    !attemptsResult.value.items.some((item) => item.sequence === sequence)
  )
    await loadAttempts(true)
  if (props.row.id !== id) return
  attemptFocus.value = sequence
  await nextTick()
  attemptsPanel.value
    ?.querySelector('[data-sequence="' + sequence + '"]')
    ?.scrollIntoView?.({ block: 'nearest' })
}
const attemptsPanel = ref<HTMLElement | null>(null)
const loadAttempts = async (append = false) => {
  if (!canReadAttempts.value || attemptsLoading.value || (append && !attemptsResult.value?.hasMore))
    return
  attemptsController = new AbortController()
  const signal = attemptsController.signal
  attemptsLoading.value = true
  attemptsError.value = ''
  try {
    const result = await aiRequestLogService.attempts(
      props.row.id,
      { cursor: append ? (attemptsResult.value?.nextCursor ?? undefined) : undefined },
      signal,
    )
    if (!signal.aborted)
      attemptsResult.value =
        append && attemptsResult.value
          ? { ...result, items: [...attemptsResult.value.items, ...result.items] }
          : result
  } catch (cause) {
    if (!signal.aborted)
      attemptsError.value = getErrorMessage(cause, i18ns.t('aiRequestLogs.attemptsFailed'))
  } finally {
    if (!signal.aborted) attemptsLoading.value = false
  }
}
watch(
  side,
  () => {
    focus.value = null
  },
  { flush: 'sync' },
)
watch(
  view,
  () => {
    focus.value = null
  },
  { flush: 'sync' },
)
watch([keyword, searchScope], () => {
  searchController?.abort()
  searchResult.value = null
  searchError.value = ''
  searchLoading.value = false
  searchHistory.value = []
})
watch(canReadAttempts, (allowed) => {
  if (!allowed) {
    attemptsController?.abort()
    attemptsResult.value = null
    attemptsLoading.value = false
    attemptFocus.value = null
    if (searchScope.value === 'attempts') searchScope.value = 'request'
  }
})
watch(
  () => props.row.id,
  () => {
    metadata.value = props.row
    side.value = 'request'
    view.value = 'parsed'
    focus.value = null
    searchController?.abort()
    attemptsController?.abort()
    attemptsResult.value = null
    attemptsLoading.value = false
    keyword.value = ''
    searchResult.value = null
    searchError.value = ''
    attemptsError.value = ''
    void loadMetadata()
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  metadataController?.abort()
  searchController?.abort()
  attemptsController?.abort()
})
</script>
<style scoped lang="scss">
.request-detail > .el-alert {
  margin: 12px 0;
}
.request-detail :deep(.el-descriptions__content) {
  overflow-wrap: anywhere;
}
.request-detail :deep(.el-descriptions__content code) {
  display: block;
  font-size: 11px;
  color: var(--el-text-color-secondary);
}
.detail-search {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 160px auto;
  gap: 8px;
  margin: 20px 0 12px;
}
.search-results {
  background: var(--el-fill-color-light);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  padding: 12px;
  max-height: 360px;
  overflow: auto;
}
.search-results header {
  display: flex;
  gap: 8px;
  align-items: center;
}
.search-hit {
  display: block;
  width: 100%;
  padding: 10px 0;
  background: none;
  border: 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
  color: var(--el-text-color-primary);
  text-align: left;
  cursor: pointer;
}
.search-hit code {
  display: block;
  font-size: 11px;
  color: var(--el-text-color-secondary);
}
.search-hit span {
  display: block;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 12px;
}
mark {
  background: var(--el-color-warning-light-5);
  color: var(--el-text-color-primary);
}
.hit-pagination,
.focus-bar,
.attempts-panel header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.source-selector {
  margin-top: 20px;
}
.focus-bar {
  padding: 8px 0;
  overflow-wrap: anywhere;
  font-size: 12px;
}
.attempts-panel {
  margin-top: 24px;
  border-top: 1px solid var(--el-border-color);
}
.attempts-panel h3 {
  font-size: 15px;
}
.attempts-panel p {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.focused-attempt {
  background: var(--el-color-warning-light-9);
}
.attempt-row {
  padding: 12px 0;
  border-top: 1px solid var(--el-border-color-lighter);
  font-size: 12px;
}
.attempt-row > span {
  margin-left: 12px;
}
.attempt-row pre {
  max-height: 180px;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
@media (max-width: 640px) {
  .detail-search {
    grid-template-columns: 1fr auto;
  }
  .detail-search > :first-child {
    grid-column: 1/-1;
  }
}
</style>
