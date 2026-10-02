<template>
  <section class="composition-editor" data-testid="composition-editor">
    <el-alert :title="i18ns.t('relay.compositeHint')" type="info" :closable="false" show-icon />
    <div class="composition-search">
      <el-input v-model="search" :placeholder="i18ns.t('relay.compositionSearch')" clearable />
      <el-button :loading="loading" @click="loadCandidates()">{{ i18ns.t('refresh') }}</el-button>
    </div>
    <el-table :data="candidates" v-loading="loading" size="small" row-key="id">
      <el-table-column :label="i18ns.t('relay.tokenName')" min-width="150">
        <template #default="{ row }"
          >{{ row.name || row.id }}
          <el-tag v-if="row.routingMode === 'composite'" size="small"
            >{{ i18ns.t('relay.routingModeComposite') }} · {{ row.memberCount }}</el-tag
          ></template
        >
      </el-table-column>
      <el-table-column width="130">
        <template #default="{ row }"
          ><el-button
            :disabled="
              !row.selectable ||
              modelValue.some((member) => member.tokenId === row.id) ||
              !limits ||
              modelValue.length >= limits.maxMembers
            "
            size="small"
            @click="add(row)"
            >{{ i18ns.t('relay.compositionAdd') }}</el-button
          ></template
        >
      </el-table-column>
    </el-table>
    <el-pagination
      v-model:current-page="page"
      :page-size="pageSize"
      :total="total"
      layout="prev, pager, next, total"
      @current-change="loadCandidates()"
    />
    <h4>{{ i18ns.t('relay.compositionMembers') }}</h4>
    <el-empty v-if="!modelValue.length" :description="i18ns.t('relay.compositionNoMembers')" />
    <div v-for="(member, index) in modelValue" :key="member.tokenId" class="composition-member">
      <div class="composition-member-heading">
        <span>#{{ index + 1 }} {{ metadata[member.tokenId]?.name || member.tokenId }}</span>
        <el-tag v-if="unavailable(member.tokenId)" type="warning" size="small">{{
          i18ns.t('relay.compositionUnavailable')
        }}</el-tag>
        <el-switch
          :model-value="member.enabled"
          :aria-label="i18ns.t('relay.compositionEnabled')"
          @change="(value: string | number | boolean) => patch(index, { enabled: Boolean(value) })"
        />
      </div>
      <div class="composition-member-actions">
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
        <el-button size="small" @click="loadDirectory(member.tokenId)">{{
          i18ns.t('relay.compositionLoadModels')
        }}</el-button>
        <el-button size="small" type="danger" plain @click="remove(index)">{{
          i18ns.t('relay.compositionRemove')
        }}</el-button>
      </div>
      <div v-if="directories[member.tokenId]" class="composition-directory">
        <el-tag v-for="protocol in protocols" :key="protocol" size="small"
          >{{ protocol }}: {{ directories[member.tokenId]![protocol]?.length || 0 }}</el-tag
        >
      </div>
      <details v-if="metadata[member.tokenId]?.memberCount" class="composition-nested">
        <summary>
          {{ i18ns.t('relay.compositionNested') }} ({{ metadata[member.tokenId]?.memberCount }})
        </summary>
        <div
          v-for="child in metadata[member.tokenId]?.memberTokenConfigs || []"
          :key="child.tokenId"
        >
          #{{ child.priority + 1 }} {{ metadata[child.tokenId]?.name || child.tokenId }}
          <el-button text size="small" @click="loadDirectory(child.tokenId)">{{
            i18ns.t('relay.compositionLoadModels')
          }}</el-button>
        </div>
      </details>
    </div>
    <el-button :disabled="!modelValue.length" :loading="previewLoading" @click="preview()">{{
      i18ns.t('relay.compositionPreview')
    }}</el-button>
    <el-text type="info">{{ i18ns.t('relay.compositionPreviewHint') }}</el-text>
    <div v-if="previewResult">
      <el-select v-model="previewProtocol"
        ><el-option
          v-for="protocol in protocols"
          :key="protocol"
          :value="protocol"
          :label="protocol"
      /></el-select>
      <el-select v-model="previewModel" filterable
        ><el-option
          v-for="model in previewResult.models[previewProtocol] || []"
          :key="model"
          :label="model"
          :value="model"
      /></el-select>
      <ol>
        <li v-for="(route, index) in previewRoutes" :key="index">
          {{
            route.tokenPathIds
              .slice(1)
              .map((id) => metadata[id]?.name || id)
              .join(' → ')
          }}
        </li>
      </ol>
    </div>
    <el-alert :title="i18ns.t('relay.compositionMeteringHint')" :closable="false" type="warning" />
  </section>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type {
  RelayCompositionCandidateDto,
  RelayCompositionCandidatesDto,
  RelayCompositionPreviewDto,
  RelayCompositionPreviewRequest,
  RelayTokenMemberConfigInputDto,
  RelayTokenAvailableModelsDto,
} from '@/client/types.gen'
import { relayTokenService } from '@/service/relayTokenService'
import { i18ns } from '@/locales'
import { showRequestErrorNotice } from '@/utils/requestErrorNotice'
const props = defineProps<{
  modelValue: RelayTokenMemberConfigInputDto[]
  editingTokenId?: string
  targetUserId?: string
  settings: Pick<
    RelayCompositionPreviewRequest,
    'modelMapping' | 'allowedModels' | 'requestFormatTransforms'
  >
}>()
const emit = defineEmits<{
  'update:modelValue': [RelayTokenMemberConfigInputDto[]]
  models: [string[]]
  defaults: [string[]]
}>()
const protocols = ['openai', 'responses', 'anthropic', 'gemini'] as const
const search = ref(''),
  page = ref(1),
  pageSize = 20,
  total = ref(0),
  loading = ref(false),
  previewLoading = ref(false)
const candidates = ref<RelayCompositionCandidateDto[]>([])
const metadata = ref<Record<string, RelayCompositionCandidateDto>>({})
const directories = ref<Record<string, RelayTokenAvailableModelsDto>>({})
const limits = ref<RelayCompositionCandidatesDto['limits']>()
const previewResult = ref<RelayCompositionPreviewDto>()
const previewProtocol = ref<(typeof protocols)[number]>('openai'),
  previewModel = ref('')
const previewRoutes = computed(
  () =>
    previewResult.value?.routes.filter(
      (route) => route.protocol === previewProtocol.value && route.model === previewModel.value,
    ) || [],
)
let previewSequence = 0
let sequence = 0,
  disposed = false,
  timer: ReturnType<typeof setTimeout> | undefined
const SEARCH_DEBOUNCE_MS = 250
async function loadCandidates() {
  const request = ++sequence
  loading.value = true
  try {
    const result = await relayTokenService.getCompositionCandidates({
      page: page.value,
      pageSize,
      search: search.value,
      editingTokenId: props.editingTokenId,
      targetUserId: props.targetUserId,
    })
    if (disposed || request !== sequence) return
    candidates.value = result.items
    total.value = result.total
    limits.value = result.limits
    emit('defaults', result.limits.retryStatusCodes)
    for (const item of result.items) metadata.value[item.id] = item
    const missing = props.modelValue
      .map((member) => member.tokenId)
      .filter((id) => !metadata.value[id])
    if (missing.length) {
      const selected = await relayTokenService.getCompositionCandidates({
        search: '__selected__',
        selectedIds: missing.join(','),
        pageSize: result.limits.maxMembers,
        editingTokenId: props.editingTokenId,
        targetUserId: props.targetUserId,
      })
      if (!disposed && request === sequence)
        for (const item of selected.items) metadata.value[item.id] = item
    }
  } catch (error) {
    if (!disposed && request === sequence)
      showRequestErrorNotice(error, i18ns.t('relay.loadFailed'))
  } finally {
    if (request === sequence) loading.value = false
  }
}
const replace = (members: RelayTokenMemberConfigInputDto[]) =>
  emit(
    'update:modelValue',
    members.map((member, priority) => ({ ...member, priority })),
  )
const add = (item: RelayCompositionCandidateDto) =>
  replace([
    ...props.modelValue,
    { tokenId: item.id, priority: props.modelValue.length, enabled: true },
  ])
const remove = (index: number) => replace(props.modelValue.filter((_, i) => i !== index))
const patch = (index: number, value: Partial<RelayTokenMemberConfigInputDto>) =>
  replace(props.modelValue.map((member, i) => (i === index ? { ...member, ...value } : member)))
const move = (index: number, direction: number) => {
  const next = [...props.modelValue]
  ;[next[index], next[index + direction]] = [next[index + direction]!, next[index]!]
  replace(next)
}
const unavailable = (id: string) =>
  !metadata.value[id] ||
  metadata.value[id]!.status !== 1 ||
  Boolean(
    metadata.value[id]!.expiresAt &&
      new Date(metadata.value[id]!.expiresAt!).getTime() < Date.now(),
  )
async function loadDirectory(id: string) {
  try {
    const directory = await relayTokenService.getTokenAvailableModels(id, props.targetUserId)
    if (disposed) return
    directories.value[id] = directory
    if (!metadata.value[id]) {
      const result = await relayTokenService.getCompositionCandidates({
        search: id,
        targetUserId: props.targetUserId,
      })
      if (!disposed) for (const item of result.items) metadata.value[item.id] = item
    }
  } catch (error) {
    if (!disposed) showRequestErrorNotice(error, i18ns.t('relay.loadFailed'))
  }
}
async function preview() {
  const request = ++previewSequence
  previewLoading.value = true
  try {
    const result = await relayTokenService.previewComposition({
      ...props.settings,
      routingMode: 'composite',
      memberTokenConfigs: props.modelValue,
      editingTokenId: props.editingTokenId || undefined,
      targetUserId: props.targetUserId,
    })
    if (disposed || request !== previewSequence) return
    previewResult.value = result
    previewProtocol.value =
      protocols.find((protocol) => result.models[protocol]?.length) || 'openai'
    previewModel.value = result.models[previewProtocol.value]?.[0] || ''
    emit('models', [...new Set(protocols.flatMap((protocol) => result.models[protocol] || []))])
  } catch (error) {
    if (!disposed) showRequestErrorNotice(error, i18ns.t('relay.loadFailed'))
  } finally {
    if (request === previewSequence) previewLoading.value = false
  }
}
watch(previewProtocol, () => {
  previewModel.value = previewResult.value?.models[previewProtocol.value]?.[0] || ''
})
watch(
  () => [props.modelValue, props.settings],
  () => {
    previewSequence++
    previewLoading.value = false
    previewResult.value = undefined
    emit('models', [])
  },
  { deep: true },
)
watch(search, () => {
  page.value = 1
  clearTimeout(timer)
  timer = setTimeout(() => void loadCandidates(), SEARCH_DEBOUNCE_MS)
})
watch(
  () => [props.editingTokenId, props.targetUserId],
  () => {
    metadata.value = {}
    directories.value = {}
    page.value = 1
    void loadCandidates()
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  disposed = true
  sequence++
  clearTimeout(timer)
})
</script>
<style scoped>
.composition-editor {
  display: grid;
  gap: 14px;
  width: 100%;
}
.composition-search,
.composition-member-heading,
.composition-member-actions,
.composition-directory {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
.composition-member {
  padding: 14px;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  display: grid;
  gap: 10px;
}
.composition-member-heading span:first-child {
  flex: 1;
  overflow-wrap: anywhere;
}
.composition-search .el-input {
  flex: 1;
}
.composition-nested {
  padding-left: 12px;
}
</style>
