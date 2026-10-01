<template>
  <section class="log-reader">
    <div class="reader-toolbar">
      <div>
        <el-switch
          v-model="loadAll"
          :disabled="loading && !info"
          :active-text="i18ns.t('aiRequestLogs.loadAll')"
        />
        <small>{{ i18ns.t('aiRequestLogs.loadAllNotice') }}</small>
      </div>
      <div>
        <el-button :disabled="!items.length" @click="copyCurrent">{{
          i18ns.t('aiRequestLogs.copyCurrent')
        }}</el-button
        ><el-button :disabled="!allComplete" @click="copyAll">{{
          i18ns.t('aiRequestLogs.copyAll')
        }}</el-button>
      </div>
    </div>
    <el-alert v-if="info?.truncated" type="warning" :closable="false">{{
      i18ns.t('aiRequestLogs.truncatedDetail')
    }}</el-alert>
    <el-alert v-if="error" type="error" :closable="false"
      ><span>{{ error }}</span
      ><el-button link @click="retry">{{ i18ns.t('aiRequestLogs.retry') }}</el-button></el-alert
    >
    <p v-if="view === 'raw'" class="reader-notice">{{ i18ns.t('aiRequestLogs.rawNotice') }}</p>
    <div
      v-bind="containerProps"
      class="reader-viewport"
      :class="{ 'raw-reader': view === 'raw' }"
      :aria-busy="loading"
      data-testid="content-viewport"
    >
      <div v-bind="wrapperProps">
        <template v-if="view === 'raw'">
          <div v-for="line in virtualRows" :key="line.index" class="raw-line">
            <span class="line-number">{{ line.index + 1 }}</span>
            <pre>{{ line.data.text }}</pre>
          </div>
        </template>
        <template v-else>
          <article
            v-for="entry in virtualRows"
            :key="entry.index"
            class="parsed-item"
            data-testid="parsed-item"
          >
            <header>
              <el-tag size="small">{{ sectionLabel(entry.data.item!.section) }}</el-tag
              ><strong>{{ entry.data.item!.label }}</strong
              ><span>{{ formatBytes(entry.data.item!.totalBytes) }}</span>
            </header>
            <code class="field-path">{{ entry.data.item!.path }}</code>
            <pre class="preview">{{ entry.data.item!.text }}</pre>
            <el-button
              v-if="entry.data.item!.expandable"
              link
              type="primary"
              @click="$emit('expand', entry.data.item!)"
              >{{ i18ns.t('aiRequestLogs.expandStructure') }}</el-button
            >
            <el-button link type="primary" @click="$emit('inspect', entry.data.item!)">{{
              i18ns.t('aiRequestLogs.readBlock')
            }}</el-button>
          </article>
        </template>
      </div>
      <p v-if="!items.length && !loading && !error" class="empty-content">
        {{ omissionLabel(info?.omissionReason) }}
      </p>
    </div>
    <footer class="reader-footer">
      <span
        >{{ i18ns.t('aiRequestLogs.loaded') }} {{ items.length }} / {{ info?.totalItems ?? '—' }} ·
        {{ formatBytes(info?.storedBytes) }}<span v-if="loading"> …</span></span
      >
      <el-button v-if="info?.hasMore" :loading="loading" :disabled="loadAll" @click="load(true)">{{
        i18ns.t('aiRequestLogs.loadMore')
      }}</el-button>
      <span v-else-if="info && items.length">{{ i18ns.t('aiRequestLogs.allFinished') }}</span>
    </footer>
  </section>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import { useVirtualList } from '@vueuse/core'
import type {
  AiRequestLogContentItemDto,
  AiRequestLogContentSide,
  AiRequestLogContentView,
} from '@/client/types.gen'
import { i18ns } from '@/locales'
import { ElMessage } from '@/utils/elementPlusRuntime'
import { showRequestErrorNotice } from '@/utils/requestErrorNotice'
import { useLogContent } from './useLogContent'
import { formatBytes, omissionLabel, sectionLabel } from './logPresentation'
const props = defineProps<{
  id: string
  side: AiRequestLogContentSide
  view: AiRequestLogContentView
  locator?: string
  offset?: number
}>()
defineEmits<{
  inspect: [item: AiRequestLogContentItemDto]
  expand: [item: AiRequestLogContentItemDto]
}>()
const { items, info, loading, error, loadAll, allComplete, fullContents, load, retry } =
  useLogContent(() => ({
    id: props.id,
    side: props.side,
    view: props.view,
    locator: props.locator,
    offset: props.offset,
  }))
const rows = computed(() =>
  props.view === 'parsed'
    ? items.value.map((item) => ({ item, text: '' }))
    : items.value.flatMap((item) =>
        item.text.split(/\r?\n/).flatMap((line) => {
          const parts: { item: AiRequestLogContentItemDto | null; text: string }[] = []
          for (let offset = 0; offset < Math.max(1, line.length); offset += 240)
            parts.push({ item: null, text: line.slice(offset, offset + 240) })
          return parts
        }),
      ),
)
const {
  list: virtualRows,
  containerProps,
  wrapperProps,
} = useVirtualList(rows, { itemHeight: () => (props.view === 'raw' ? 24 : 180), overscan: 4 })
const copyCurrent = async () => {
  try {
    await navigator.clipboard.writeText(items.value[items.value.length - 1]?.text ?? '')
    ElMessage.success(i18ns.t('aiRequestLogs.copied'))
  } catch (error) {
    showRequestErrorNotice(error, i18ns.t('aiRequestLogs.detailLoadFailed'))
  }
}
const copyAll = async () => {
  if (!allComplete.value) return
  const text =
    props.view === 'raw'
      ? items.value.map((item) => item.text).join('')
      : items.value
          .map((item) => item.label + '\n' + (fullContents.value.get(item.locator) ?? item.text))
          .join('\n\n')
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success(i18ns.t('aiRequestLogs.copied'))
  } catch (error) {
    showRequestErrorNotice(error, i18ns.t('aiRequestLogs.detailLoadFailed'))
  }
}
defineExpose({ items, info, loadAll, allComplete })
</script>
<style scoped lang="scss">
.log-reader {
  min-width: 0;
}
.reader-toolbar,
.reader-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 0;
  flex-wrap: wrap;
}
.reader-toolbar small {
  display: block;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.reader-notice {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.reader-viewport {
  height: 480px;
  overflow: auto;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  background: var(--el-bg-color);
}
.parsed-item {
  height: 180px;
  box-sizing: border-box;
  padding: 12px 16px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.parsed-item header {
  display: flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
  overflow: hidden;
}
.parsed-item header strong {
  overflow: hidden;
  text-overflow: ellipsis;
}
.parsed-item header > span:last-child {
  margin-left: auto;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.field-path {
  display: block;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--el-text-color-secondary);
  font-size: 11px;
  margin: 5px 0;
}
.preview {
  white-space: pre-wrap;
  overflow: hidden;
  line-height: 18px;
  height: 72px;
  margin: 6px 0;
  font-family: var(--el-font-family);
  font-size: 12px;
}
.raw-line {
  height: 24px;
  display: flex;
  align-items: center;
  font:
    12px/24px ui-monospace,
    SFMono-Regular,
    Consolas,
    monospace;
}
.raw-line pre {
  margin: 0;
  line-height: 24px;
  white-space: pre;
}
.line-number {
  width: 52px;
  min-width: 52px;
  color: var(--el-text-color-placeholder);
  text-align: right;
  padding-right: 12px;
  user-select: none;
}
.empty-content {
  padding: 24px;
  color: var(--el-text-color-secondary);
}
.reader-footer {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
@media (max-width: 640px) {
  .reader-viewport {
    height: 55vh;
  }
  .parsed-item {
    padding: 12px;
  }
}
</style>
