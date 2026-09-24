<template>
  <el-dialog
    v-model="showChannelModelBatchDialog"
    :title="i18ns.t('relay.channelModelBatchTitle')"
    :width="isDesktop ? 'min(1120px, calc(100vw - 64px))' : 'calc(100% - 24px)'"
    destroy-on-close
    :close-on-click-modal="false"
  >
    <p class="model-batch__intro">
      {{ i18ns.t('relay.channelModelBatchDescription', { count: selectedChannelIds.length }) }}
    </p>
    <el-alert
      type="info"
      :closable="false"
      show-icon
      :title="i18ns.t('relay.channelModelBatchApplyHelp')"
      class="mb-3"
    />

    <el-tabs v-model="activeFormat" class="model-batch__tabs">
      <el-tab-pane
        v-for="formatOption in formatOptions"
        :key="formatOption.value"
        :label="formatOption.label"
        :name="formatOption.value"
      >
        <div class="model-batch__probe-toolbar">
          <el-button
            type="primary"
            plain
            :loading="probingFormat === formatOption.value"
            @click="probeFormat(formatOption.value)"
          >
            {{ i18ns.t('relay.discoverModels') }}
          </el-button>
          <span v-if="formatItems(formatOption.value).length" class="model-batch__status">
            {{
              i18ns.t('relay.channelModelBatchStatus', {
                success: formatStatusCount(formatOption.value, 'success'),
                skipped: formatStatusCount(formatOption.value, 'skipped'),
                failed: formatStatusCount(formatOption.value, 'failed'),
              })
            }}
          </span>
        </div>

        <el-table
          v-if="formatItems(formatOption.value).length"
          :data="formatItems(formatOption.value)"
          size="small"
          max-height="260"
          class="model-batch__channel-table"
        >
          <el-table-column
            prop="channelName"
            :label="i18ns.t('relay.channelName')"
            min-width="180"
          />
          <el-table-column :label="i18ns.t('status')" width="110">
            <template #default="{ row }">
              <el-tag :type="statusType(row.status)" size="small">{{
                statusLabel(row.status)
              }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column :label="i18ns.t('relay.channelModelBatchModelCount')" width="110">
            <template #default="{ row }">{{ row.models.length }}</template>
          </el-table-column>
          <el-table-column :label="i18ns.t('relay.channelModelBatchReason')" min-width="180">
            <template #default="{ row }">
              {{ row.status === 'success' ? '-' : failureReason(row.status) }}
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>
    </el-tabs>

    <section v-if="aggregatedModels.length" class="model-batch__models">
      <div class="model-batch__models-header">
        <div>
          <strong>{{ i18ns.t('relay.channelModelBatchModels') }}</strong>
          <span class="model-batch__models-summary">
            {{ i18ns.t('relay.channelModelBatchSelected', { count: selectedModels.length }) }}
          </span>
        </div>
        <div class="model-batch__models-actions">
          <el-input
            v-model="modelKeyword"
            clearable
            :placeholder="i18ns.t('relay.channelModelBatchSearch')"
          />
          <el-button size="small" @click="selectAllMatchedModels">{{
            i18ns.t('relay.channelModelBatchSelectAll')
          }}</el-button>
          <el-button size="small" @click="selectedModels = []">{{
            i18ns.t('relay.channelModelBatchClear')
          }}</el-button>
        </div>
      </div>
      <div class="model-batch__model-list">
        <el-checkbox-group v-model="selectedModels">
          <el-checkbox
            v-for="model in filteredAggregatedModels"
            :key="model.value"
            :value="model.value"
            :disabled="!model.matched"
            class="model-batch__model-option"
          >
            <span class="model-batch__model-name">{{ model.value }}</span>
            <el-tag v-if="model.matched" size="small" type="success">
              {{ i18ns.t('relay.channelModelBatchCoverage', { count: model.channelIds.size }) }}
            </el-tag>
            <el-tag v-else size="small" type="info">{{ i18ns.t('relay.unmatchedModel') }}</el-tag>
          </el-checkbox>
        </el-checkbox-group>
      </div>
    </section>
    <el-empty v-else :description="i18ns.t('relay.channelModelBatchEmpty')" :image-size="80" />

    <template #footer>
      <el-button @click="showChannelModelBatchDialog = false">{{ i18ns.t('cancel') }}</el-button>
      <el-button
        type="primary"
        :disabled="selectedModels.length === 0 || applicableTargetCount === 0"
        :loading="applying"
        @click="applyRestrictions"
      >
        {{ i18ns.t('relay.channelModelBatchApply') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from '@/utils/elementPlusRuntime'
import { showRequestErrorNotice } from '@/utils/requestErrorNotice'
import type {
  BatchRelayChannelUpstreamModelsItemDto,
  BatchRelayChannelUpstreamModelStatus,
  RelayUpstreamFormat,
} from '@/client/types.gen'
import { relayChannelService } from '@/service/relayChannelService'
import { i18ns } from '@/locales'
import { useRelaySettingsManagementContext } from '../context'

type ProbeFormat = Extract<RelayUpstreamFormat, 'openai' | 'anthropic' | 'gemini'>
interface AggregatedModel {
  value: string
  matched: boolean
  channelIds: Set<string>
}

const {
  isDesktop,
  showChannelModelBatchDialog,
  selectedChannelIds,
  handleModelRestrictionsApplied,
} = useRelaySettingsManagementContext()

const formatOptions: Array<{ value: ProbeFormat; label: string }> = [
  { value: 'openai', label: i18ns.t('relay.formatOpenAI') },
  { value: 'anthropic', label: i18ns.t('relay.formatAnthropic') },
  { value: 'gemini', label: i18ns.t('relay.formatGemini') },
]
const activeFormat = ref<ProbeFormat>('openai')
const probingFormat = ref<ProbeFormat | ''>('')
const applying = ref(false)
const modelKeyword = ref('')
const selectedModels = ref<string[]>([])
const results = ref<Record<ProbeFormat, BatchRelayChannelUpstreamModelsItemDto[]>>({
  openai: [],
  anthropic: [],
  gemini: [],
})

watch(showChannelModelBatchDialog, (visible) => {
  if (!visible) return
  activeFormat.value = 'openai'
  probingFormat.value = ''
  applying.value = false
  modelKeyword.value = ''
  selectedModels.value = []
  results.value = { openai: [], anthropic: [], gemini: [] }
})

const formatItems = (format: ProbeFormat) => results.value[format]

const aggregatedModels = computed<AggregatedModel[]>(() => {
  const models = new Map<string, AggregatedModel>()
  for (const format of formatOptions.map((option) => option.value)) {
    for (const item of results.value[format]) {
      if (item.status !== 'success') continue
      for (const model of item.models) {
        const value = model.matched ? model.pricingModel || model.id : model.id
        const existing = models.get(value) ?? {
          value,
          matched: false,
          channelIds: new Set<string>(),
        }
        existing.matched = existing.matched || model.matched
        existing.channelIds.add(item.channelId)
        models.set(value, existing)
      }
    }
  }
  return [...models.values()].sort(
    (left, right) =>
      Number(right.matched) - Number(left.matched) ||
      right.channelIds.size - left.channelIds.size ||
      left.value.localeCompare(right.value),
  )
})

const filteredAggregatedModels = computed(() => {
  const keyword = modelKeyword.value.trim().toLowerCase()
  if (!keyword) return aggregatedModels.value
  return aggregatedModels.value.filter((model) => model.value.toLowerCase().includes(keyword))
})

const supportedModelsByChannel = computed(() => {
  const supported = new Map<string, Set<string>>()
  for (const format of formatOptions.map((option) => option.value)) {
    for (const item of results.value[format]) {
      if (item.status !== 'success') continue
      const channelModels = supported.get(item.channelId) ?? new Set<string>()
      for (const model of item.models) {
        if (model.matched) channelModels.add(model.pricingModel || model.id)
      }
      supported.set(item.channelId, channelModels)
    }
  }
  return supported
})

const applicableTargetCount = computed(
  () =>
    selectedChannelIds.value.filter((channelId) =>
      selectedModels.value.some((model) =>
        supportedModelsByChannel.value.get(channelId)?.has(model),
      ),
    ).length,
)

const selectAllMatchedModels = () => {
  selectedModels.value = aggregatedModels.value
    .filter((model) => model.matched)
    .map((model) => model.value)
}

const probeFormat = async (format: ProbeFormat) => {
  if (selectedChannelIds.value.length === 0) return
  probingFormat.value = format
  try {
    const result = await relayChannelService.batchListUpstreamModels({
      ids: selectedChannelIds.value,
      format,
    })
    results.value[format] = result.items
    selectedModels.value = aggregatedModels.value
      .filter((model) => model.matched)
      .map((model) => model.value)
    ElMessage.success(i18ns.t('relay.modelDiscoverySuccess'))
  } catch (error) {
    showRequestErrorNotice(error, i18ns.t('relay.loadFailed'))
  } finally {
    probingFormat.value = ''
  }
}

const applyRestrictions = async () => {
  const targets = selectedChannelIds.value
    .map((channelId) => ({
      channelId,
      addModels: selectedModels.value.filter((model) =>
        supportedModelsByChannel.value.get(channelId)?.has(model),
      ),
    }))
    .filter((target) => target.addModels.length > 0)
  if (targets.length === 0) {
    ElMessage.warning(i18ns.t('relay.channelModelBatchNoApplicable'))
    return
  }

  applying.value = true
  try {
    const result = await relayChannelService.applyModelRestrictions({ targets })
    await handleModelRestrictionsApplied(result.updated.map((channel) => channel.id))
    if (result.updated.length > 0) {
      ElMessage.success(
        i18ns.t('relay.channelModelBatchApplySuccess', { count: result.updated.length }),
      )
    }
    if (result.rejected.length > 0) {
      await ElMessageBox.alert(
        result.rejected.map((item) => `${item.id}: ${item.reason}`).join('\n'),
        i18ns.t('relay.channelModelBatchApplyRejected', { count: result.rejected.length }),
        { type: 'warning' },
      )
      return
    }
    showChannelModelBatchDialog.value = false
  } catch (error) {
    showRequestErrorNotice(error, i18ns.t('operationFailed'))
  } finally {
    applying.value = false
  }
}

const formatStatusCount = (format: ProbeFormat, status: BatchRelayChannelUpstreamModelStatus) =>
  results.value[format].filter((item) => item.status === status).length

const statusType = (status: BatchRelayChannelUpstreamModelStatus) => {
  if (status === 'success') return 'success'
  if (status === 'skipped') return 'info'
  return 'danger'
}

const statusLabel = (status: BatchRelayChannelUpstreamModelStatus) => {
  if (status === 'success') return i18ns.t('relay.channelModelBatchProbeSuccess')
  if (status === 'skipped') return i18ns.t('relay.channelModelBatchProbeSkipped')
  return i18ns.t('relay.channelModelBatchProbeFailed')
}

const failureReason = (status: BatchRelayChannelUpstreamModelStatus) =>
  status === 'skipped'
    ? i18ns.t('relay.channelModelBatchSkipReason')
    : i18ns.t('relay.channelModelBatchFailureReason')
</script>

<style scoped>
.model-batch__intro {
  margin: 0 0 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.55;
}
.model-batch__probe-toolbar,
.model-batch__models-header,
.model-batch__models-actions,
.model-batch__status {
  display: flex;
  align-items: center;
  gap: 10px;
}
.model-batch__probe-toolbar {
  margin-bottom: 12px;
}
.model-batch__status {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.model-batch__channel-table {
  margin-bottom: 4px;
}
.model-batch__models {
  margin-top: 8px;
  padding-top: 14px;
  border-top: 1px solid var(--el-border-color-lighter);
}
.model-batch__models-header {
  justify-content: space-between;
  margin-bottom: 10px;
}
.model-batch__models-summary {
  margin-left: 10px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.model-batch__models-actions :deep(.el-input) {
  width: 220px;
}
.model-batch__model-list {
  max-height: 260px;
  overflow-y: auto;
  padding: 10px 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background: var(--el-fill-color-lighter);
}
.model-batch__model-list :deep(.el-checkbox-group) {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 18px;
}
.model-batch__model-option {
  min-width: 0;
  margin-right: 0;
}
.model-batch__model-option :deep(.el-checkbox__label) {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.model-batch__model-name {
  overflow-wrap: anywhere;
}
@media (max-width: 760px) {
  .model-batch__models-header,
  .model-batch__models-actions,
  .model-batch__probe-toolbar {
    align-items: stretch;
    flex-direction: column;
  }
  .model-batch__models-actions :deep(.el-input) {
    width: 100%;
  }
  .model-batch__model-list :deep(.el-checkbox-group) {
    grid-template-columns: 1fr;
  }
}
</style>
