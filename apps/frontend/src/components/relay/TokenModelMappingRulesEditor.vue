<template>
  <section class="token-mapping-editor" data-testid="token-mapping-editor">
    <el-alert :title="i18ns.t('relay.tokenMappingHelp')" type="info" :closable="false" />
    <article
      v-for="(rule, index) in modelValue"
      :key="index"
      class="token-mapping-rule"
      data-testid="mapping-rule"
    >
      <div class="token-mapping-fields">
        <label>
          {{ i18ns.t('relay.modelMappingSource') }}
          <el-input
            :model-value="rule.source"
            :maxlength="RELAY_TOKEN_MODEL_MAPPING_LIMITS.maxPatternLength"
            :aria-label="i18ns.t('relay.modelMappingSource')"
            :placeholder="i18ns.t('relay.modelMappingSourcePlaceholder')"
            @update:model-value="patch(index, { source: $event })"
          />
        </label>
        <label>
          {{ i18ns.t('relay.modelMappingTarget') }}
          <el-select
            :model-value="rule.target"
            filterable
            allow-create
            default-first-option
            :aria-label="i18ns.t('relay.modelMappingTarget')"
            :placeholder="i18ns.t('relay.modelMappingTargetPlaceholder')"
            @update:model-value="patch(index, { target: $event })"
          >
            <el-option
              v-for="model in targetModels(rule.target)"
              :key="model"
              :label="model"
              :value="model"
            />
          </el-select>
        </label>
        <label>
          {{ i18ns.t('relay.tokenMappingScope') }}
          <el-select
            :model-value="rule.channelIds || []"
            multiple
            filterable
            remote
            reserve-keyword
            collapse-tags
            collapse-tags-tooltip
            :loading="candidateLoading"
            :remote-method="searchChannels"
            :aria-label="i18ns.t('relay.tokenMappingScope')"
            :placeholder="i18ns.t('relay.tokenMappingGlobal')"
            @visible-change="(visible: boolean) => visible && openScope(index)"
            @update:model-value="patch(index, { channelIds: $event.length ? $event : undefined })"
          >
            <el-option
              v-for="channel in channelOptions(rule.channelIds)"
              :key="channel.id"
              :value="channel.id"
              :label="channel.name"
            />
            <template #footer>
              <el-pagination
                v-model:current-page="candidatePage"
                :page-size="pageSize"
                :total="candidateTotal"
                layout="prev, pager, next, total"
                @current-change="loadCandidates()"
              />
              <el-text v-if="candidateError" type="danger" role="alert">{{
                candidateError
              }}</el-text>
            </template>
          </el-select>
        </label>
        <label>
          {{ i18ns.t('relay.tokenMappingPreference') }}
          <el-select
            :model-value="rule.preference"
            :aria-label="i18ns.t('relay.tokenMappingPreference')"
            @update:model-value="patch(index, { preference: $event })"
          >
            <el-option value="mapping-first" :label="i18ns.t('relay.tokenMappingFirst')" />
            <el-option value="original-first" :label="i18ns.t('relay.tokenMappingOriginalFirst')" />
          </el-select>
        </label>
      </div>
      <div class="token-mapping-actions">
        <span>#{{ index + 1 }}</span>
        <el-button
          size="small"
          :disabled="index === 0"
          :aria-label="i18ns.t('relay.compositionMoveUp')"
          @click="move(index, -1)"
          >↑</el-button
        >
        <el-button
          size="small"
          :disabled="index === modelValue.length - 1"
          :aria-label="i18ns.t('relay.compositionMoveDown')"
          @click="move(index, 1)"
          >↓</el-button
        >
        <el-button
          size="small"
          :disabled="modelValue.length >= RELAY_TOKEN_MODEL_MAPPING_LIMITS.maxRules"
          @click="copyRule(index)"
          >{{ i18ns.t('relay.tokenMappingCopy') }}</el-button
        >
        <el-button size="small" type="danger" plain @click="remove(index)">{{
          i18ns.t('delete')
        }}</el-button>
      </div>
      <el-alert
        v-for="(diagnostic, diagnosticIndex) in diagnostics.filter(
          (item) => item.ruleIndex === index,
        )"
        :key="diagnosticIndex"
        :title="diagnosticLabel(diagnostic)"
        :type="diagnostic.severity"
        :closable="false"
        show-icon
      />
    </article>
    <el-alert
      v-for="(diagnostic, index) in diagnostics.filter((item) => item.ruleIndex < 0)"
      :key="index"
      :title="diagnosticLabel(diagnostic)"
      :type="diagnostic.severity"
      :closable="false"
    />
    <div class="token-mapping-actions">
      <el-button
        :disabled="modelValue.length >= RELAY_TOKEN_MODEL_MAPPING_LIMITS.maxRules"
        data-testid="add-rule"
        @click="add"
        >+ {{ i18ns.t('relay.modelMappingAdd') }}</el-button
      >
      <el-button data-testid="import-rules" @click="showImport = !showImport">{{
        i18ns.t('relay.tokenMappingImport')
      }}</el-button>
      <el-button data-testid="export-rules" @click="exportRules">{{
        i18ns.t('relay.tokenMappingExport')
      }}</el-button>
    </div>
    <div v-if="showImport" class="token-mapping-editor">
      <el-input
        v-model="importText"
        type="textarea"
        :rows="6"
        :aria-label="i18ns.t('relay.tokenMappingImport')"
        placeholder='[{ "source": "friendly-*", "target": "model", "preference": "mapping-first" }]'
      />
      <el-text v-if="importError" type="danger" role="alert">{{ importError }}</el-text>
      <el-button data-testid="apply-import" @click="importRules">{{
        i18ns.t('confirm')
      }}</el-button>
    </div>
    <div class="token-mapping-preview">
      <h4>{{ i18ns.t('relay.tokenMappingPreview') }}</h4>
      <div class="token-mapping-fields">
        <el-select
          v-model="requestModel"
          filterable
          allow-create
          default-first-option
          clearable
          :aria-label="i18ns.t('relay.tokenMappingRequestModel')"
          :placeholder="i18ns.t('relay.tokenMappingRequestModel')"
        >
          <el-option v-for="model in availableModels" :key="model" :value="model" :label="model" />
        </el-select>
        <el-select v-model="requestFormat" :aria-label="i18ns.t('relay.sourceFormat')">
          <el-option v-for="format in formats" :key="format" :label="format" :value="format" />
        </el-select>
      </div>
      <el-text v-if="!requestModel" type="info">{{
        i18ns.t('relay.tokenMappingPreviewHint')
      }}</el-text>
      <el-text v-if="previewError" type="danger" role="alert">{{ previewError }}</el-text>
      <div v-loading="previewLoading" aria-live="polite">
        <el-table v-if="previewResult" :data="previewResult.items" size="small">
          <el-table-column
            prop="channelName"
            :label="i18ns.t('relay.tokenMappingChannel')"
            min-width="130"
          />
          <el-table-column :label="i18ns.t('relay.tokenMappingPath')" min-width="160"
            ><template #default="{ row }"
              ><span data-testid="mapping-path">{{
                row.tokenPathIds.map(tokenLabel).join(' → ')
              }}</span></template
            ></el-table-column
          >
          <el-table-column
            prop="requestedModel"
            :label="i18ns.t('relay.tokenMappingRequestModel')"
            min-width="140"
          />
          <el-table-column
            prop="effectiveModel"
            :label="i18ns.t('relay.tokenMappingEffectiveModel')"
            min-width="140"
          />
          <el-table-column
            prop="ruleSource"
            :label="i18ns.t('relay.tokenMappingRuleOwner')"
            min-width="140"
            ><template #default="{ row }"
              ><span data-testid="mapping-rule-owner">{{
                tokenLabel(row.ruleSource)
              }}</span></template
            ></el-table-column
          >
          <el-table-column :label="i18ns.t('relay.tokenMappingOutcome')" min-width="110"
            ><template #default="{ row }">{{
              outcomeLabel(row.outcome)
            }}</template></el-table-column
          >
          <el-table-column
            prop="reason"
            :label="i18ns.t('relay.tokenMappingReason')"
            min-width="180"
            ><template #default="{ row }"
              ><span data-testid="mapping-reason">{{ reasonLabel(row.reason) }}</span></template
            ></el-table-column
          >
        </el-table>
      </div>
      <el-pagination
        v-if="previewResult"
        v-model:current-page="previewPage"
        :page-size="pageSize"
        :total="previewResult.total"
        layout="prev, pager, next, total"
      />
      <el-alert
        v-for="(diagnostic, index) in previewResult?.diagnostics || []"
        :key="index"
        :type="diagnostic.severity"
        :title="diagnosticLabel(diagnostic)"
        :closable="false"
      />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  analyzeRelayTokenModelMappingRules,
  normalizeRelayTokenModelMappingRules,
  RELAY_TOKEN_MODEL_MAPPING_LIMITS,
  type RelayTokenModelMappingRule,
} from '@quyan/shared'
import { relayTokenService } from '@/service/relayTokenService'
import { i18ns } from '@/locales'
import { copyTextWithFallback } from '@/utils/clipboard'
import { ElMessage } from '@/utils/elementPlusRuntime'

type PreviewRequest = Parameters<typeof relayTokenService.previewModelMapping>[0]
type PreviewResult = Awaited<ReturnType<typeof relayTokenService.previewModelMapping>>
type Diagnostic = { code: string; ruleIndex: number; otherRuleIndex?: number }
const props = defineProps<{
  modelValue: RelayTokenModelMappingRule[]
  availableModels: string[]
  draft: PreviewRequest['draft']
}>()
const emit = defineEmits<{ 'update:modelValue': [RelayTokenModelMappingRule[]] }>()
const diagnostics = computed(() => analyzeRelayTokenModelMappingRules(props.modelValue))
const diagnosticLabel = (item: Diagnostic) => {
  const message =
    item.code === 'duplicate-source'
      ? i18ns.t('relay.tokenMappingDuplicate')
      : item.code === 'overlapping-patterns'
        ? i18ns.t('relay.tokenMappingOverlap')
        : i18ns.t('relay.tokenMappingInvalid')
  return `${item.ruleIndex >= 0 ? `#${item.ruleIndex + 1} ` : ''}${message}${item.otherRuleIndex === undefined ? '' : ` (#${item.otherRuleIndex + 1})`}`
}
const patch = (index: number, update: Partial<RelayTokenModelMappingRule>) =>
  emit(
    'update:modelValue',
    props.modelValue.map((rule, i) => (i === index ? { ...rule, ...update } : rule)),
  )
const add = () =>
  emit('update:modelValue', [
    ...props.modelValue,
    { source: '', target: '', preference: 'mapping-first' },
  ])
const remove = (index: number) =>
  emit(
    'update:modelValue',
    props.modelValue.filter((_, i) => i !== index),
  )
const copyRule = (index: number) => {
  const rules = [...props.modelValue]
  rules.splice(index + 1, 0, {
    ...rules[index]!,
    ...(rules[index]!.channelIds ? { channelIds: rules[index]!.channelIds!.slice() } : {}),
  })
  emit('update:modelValue', rules)
}
const move = (index: number, direction: number) => {
  const rules = [...props.modelValue]
  ;[rules[index], rules[index + direction]] = [rules[index + direction]!, rules[index]!]
  emit('update:modelValue', rules)
}
const targetModels = (saved: string) => [
  ...new Set([...props.availableModels, saved].filter(Boolean)),
]
const showImport = ref(false),
  importText = ref(''),
  importError = ref('')
function importRules() {
  try {
    const value: unknown = JSON.parse(importText.value)
    const errors = analyzeRelayTokenModelMappingRules(value).filter(
      (item) => item.severity === 'error',
    )
    if (errors.length) {
      importError.value = errors.map(diagnosticLabel).join('\n')
      return
    }
    emit('update:modelValue', normalizeRelayTokenModelMappingRules(value))
    importError.value = ''
    showImport.value = false
  } catch {
    importError.value = i18ns.t('relay.tokenMappingInvalid')
  }
}
async function exportRules() {
  if (await copyTextWithFallback(JSON.stringify(props.modelValue, null, 2)))
    ElMessage.success(i18ns.t('copySuccess'))
  else ElMessage.error(i18ns.t('copyFailed'))
}

const pageSize = 20
const DEBOUNCE_MS = 300
const formats = ['openai-chat-completions', 'openai-responses', 'anthropic', 'gemini'] as const
const requestModel = ref(''),
  requestFormat = ref<(typeof formats)[number]>('openai-chat-completions')
const previewPage = ref(1),
  previewResult = ref<PreviewResult>(),
  previewLoading = ref(false),
  previewError = ref('')
const candidatePage = ref(1),
  candidateTotal = ref(0),
  candidateLoading = ref(false),
  candidateError = ref(''),
  candidateSearch = ref('')
const candidates = ref<{ id: string; name: string }[]>([])
const selectedNames = ref<Record<string, string>>({})
const activeRuleIndex = ref(0)
let previewSequence = 0,
  candidateSequence = 0,
  disposed = false
let previewTimer: ReturnType<typeof setTimeout> | undefined,
  candidateTimer: ReturnType<typeof setTimeout> | undefined
const channelOptions = (ids: string[] = []) => [
  ...new Map(
    [...ids.map((id) => ({ id, name: selectedNames.value[id] || id })), ...candidates.value].map(
      (item) => [item.id, item],
    ),
  ).values(),
]
function searchChannels(search: string) {
  candidateSearch.value = search
}
function openScope(index: number) {
  activeRuleIndex.value = index
  candidateSearch.value = ''
  candidatePage.value = 1
  void loadCandidates()
}
async function loadCandidates() {
  clearTimeout(candidateTimer)
  const request = ++candidateSequence
  candidateLoading.value = true
  candidateError.value = ''
  const selectedIds = [...new Set(props.modelValue[activeRuleIndex.value]?.channelIds || [])]
  try {
    const result = await relayTokenService.getModelMappingChannelOptions({
      draft: { ...props.draft, modelMappingRules: props.modelValue },
      search: candidateSearch.value,
      selectedIds,
      page: candidatePage.value,
      pageSize,
    })
    if (disposed || request !== candidateSequence) return
    candidates.value = result.items
    candidateTotal.value = result.total
    for (const item of result.items) selectedNames.value[item.id] = item.name
  } catch {
    if (!disposed && request === candidateSequence)
      candidateError.value = i18ns.t('relay.loadFailed')
  } finally {
    if (request === candidateSequence) candidateLoading.value = false
  }
}
async function preview() {
  const request = ++previewSequence
  if (!requestModel.value || diagnostics.value.some((item) => item.severity === 'error')) return
  previewLoading.value = true
  try {
    const result = await relayTokenService.previewModelMapping({
      draft: { ...props.draft, modelMappingRules: props.modelValue },
      requestModel: requestModel.value,
      requestFormat: requestFormat.value,
      page: previewPage.value,
      pageSize,
    })
    if (disposed || request !== previewSequence) return
    previewResult.value = result
  } catch {
    if (!disposed && request === previewSequence) previewError.value = i18ns.t('relay.loadFailed')
  } finally {
    if (request === previewSequence) previewLoading.value = false
  }
}
const outcomeLabel = (outcome: PreviewResult['items'][number]['outcome']) =>
  ({
    mapped: i18ns.t('relay.tokenMappingMapped'),
    original: i18ns.t('relay.tokenMappingOriginal'),
    fallback: i18ns.t('relay.tokenMappingFallback'),
    unavailable: i18ns.t('relay.compositionUnavailable'),
  })[outcome]
function reasonLabel(reason: string) {
  switch (reason) {
    case 'mapped':
    case 'original':
    case 'fallback':
      return outcomeLabel(reason)
    case 'model-unavailable':
    case 'mapped-model-unavailable':
      return i18ns.t('relay.tokenMappingModelUnavailable')
    case 'format-unsupported':
      return i18ns.t('relay.tokenMappingFormatUnsupported')
    case 'model-not-allowed':
      return i18ns.t('relay.tokenMappingWhitelistDenied')
    case 'multiplier-exceeded':
      return i18ns.t('relay.tokenMappingMultiplierExceeded')
    default:
      return i18ns.t('relay.tokenMappingReasonUnknown')
  }
}
function tokenLabel(id?: string) {
  if (!id) return '—'
  return id === '__model_mapping_preview__' || id === props.draft.editingTokenId
    ? i18ns.t('relay.tokenMappingCurrentToken')
    : id
}
watch(
  () => [props.draft, props.modelValue, requestModel.value, requestFormat.value],
  () => {
    previewPage.value = 1
  },
  { deep: true, flush: 'sync' },
)
watch(
  () => [props.draft, props.modelValue, requestModel.value, requestFormat.value, previewPage.value],
  () => {
    ++previewSequence
    clearTimeout(previewTimer)
    previewResult.value = undefined
    previewError.value = ''
    previewLoading.value = false
    previewTimer = setTimeout(() => void preview(), DEBOUNCE_MS)
  },
  { deep: true, flush: 'sync' },
)
watch(
  () => [props.draft, props.modelValue, candidateSearch.value],
  () => {
    ++candidateSequence
    clearTimeout(candidateTimer)
    candidatePage.value = 1
    candidates.value = []
    candidateTotal.value = 0
    candidateLoading.value = false
    candidateError.value = ''
    candidateTimer = setTimeout(() => void loadCandidates(), DEBOUNCE_MS)
  },
  { deep: true, immediate: true, flush: 'sync' },
)
watch(
  () => props.draft.targetUserId,
  () => {
    selectedNames.value = {}
  },
  { flush: 'sync' },
)
onBeforeUnmount(() => {
  disposed = true
  ++previewSequence
  ++candidateSequence
  clearTimeout(previewTimer)
  clearTimeout(candidateTimer)
})
</script>

<style scoped>
.token-mapping-editor,
.token-mapping-rule,
.token-mapping-preview {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 12px;
  min-width: 0;
  width: 100%;
}
.token-mapping-rule,
.token-mapping-preview {
  padding: 12px;
  border: 1px solid var(--el-border-color);
  border-radius: var(--el-border-radius-base);
}
.token-mapping-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.token-mapping-fields label {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 4px;
  min-width: 0;
  font-size: var(--el-font-size-small);
}
.token-mapping-fields .el-select {
  width: 100%;
}
.token-mapping-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.token-mapping-actions .el-button + .el-button {
  margin-left: 0;
}
.token-mapping-preview h4 {
  margin: 0;
}
@media (max-width: 640px) {
  .token-mapping-fields {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
