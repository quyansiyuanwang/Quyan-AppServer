<template>
  <el-drawer
    v-model="open"
    direction="rtl"
    :size="isDesktop ? 'min(1120px, calc(100vw - 64px))' : '100%'"
    :title="title"
    class="relay-channel-editor-drawer"
    destroy-on-close
  >
    <el-alert
      v-if="submitMode === 'change'"
      type="info"
      :closable="false"
      :title="i18ns.t('relay.changeRequestReviewOnly')"
      class="mb-4"
    />
    <el-form :model="editorForm" label-width="180px" label-position="right" class="standalone-form">
      <el-form-item :label="i18ns.t('relay.channelName')" required>
        <el-input
          v-model="editorForm.name"
          :placeholder="i18ns.t('relay.channelNamePlaceholder')"
        />
      </el-form-item>

      <el-divider data-section="formats" content-position="left">{{
        i18ns.t('relay.formatAndModelRestrictions')
      }}</el-divider>
      <el-form-item :label="i18ns.t('relay.allowedFormats')" required>
        <el-checkbox-group v-model="editorForm.formats">
          <el-checkbox value="openai-chat-completions">{{
            i18ns.t('relay.formatOpenAIChatCompletions')
          }}</el-checkbox>
          <el-checkbox value="openai-responses">{{
            i18ns.t('relay.formatOpenAIResponses')
          }}</el-checkbox>
          <el-checkbox value="anthropic">{{ i18ns.t('relay.formatAnthropic') }}</el-checkbox>
          <el-checkbox value="gemini">{{ i18ns.t('relay.formatGemini') }}</el-checkbox>
        </el-checkbox-group>
        <div class="hint">{{ i18ns.t('relay.allowedFormatsHelp') }}</div>
      </el-form-item>
      <el-form-item :label="i18ns.t('relay.allowedModelsChannel')">
        <el-switch
          v-if="mode === 'management'"
          v-model="editorForm.restrictModels"
          :active-text="i18ns.t('relay.restrictModels')"
          :inactive-text="i18ns.t('relay.allowAllModels')"
          class="model-toggle"
        />
        <el-select
          v-if="mode === 'provider' || editorForm.restrictModels"
          v-model="editorForm.allowedModels"
          multiple
          filterable
          allow-create
          default-first-option
          class="full-width"
          :placeholder="i18ns.t('relay.allowedModelsManualPlaceholder')"
        >
          <el-option
            v-for="option in modelOptions"
            :key="option.value"
            :label="option.label"
            :value="option.value"
            :disabled="option.disabled"
          />
        </el-select>
        <div class="hint">{{ i18ns.t('relay.allowedModelsChannelHelp') }}</div>
      </el-form-item>

      <slot name="management-sections" />

      <el-divider data-section="upstreams" content-position="left">{{
        i18ns.t('relay.upstreamSettings')
      }}</el-divider>
      <template v-for="format in upstreamFormats" :key="format">
        <el-form-item :label="`${format.toUpperCase()} URL`" required>
          <el-input v-model="editorForm.urls[format]" />
        </el-form-item>
        <el-form-item :label="i18ns.t('relay.apiKey')" required>
          <el-input
            v-model="editorForm.keys[format]"
            type="password"
            show-password
            :placeholder="
              editorForm.hasKeys[format] ? i18ns.t('relay.apiKeyReplacePlaceholder') : ''
            "
            @update:model-value="markKeyTouched(format)"
          />
          <div v-if="editorForm.hasKeys[format]" class="hint">
            {{
              submitMode === 'change'
                ? i18ns.t('relay.credentialRetainHelp')
                : i18ns.t('relay.apiKeyConfigured')
            }}
          </div>
          <div class="probe-row" v-if="mode === 'provider'">
            <el-button
              size="small"
              :loading="probeLoading[format]"
              :icon="Search"
              @click="$emit('probe', format)"
            >
              {{ i18ns.t('relay.discoverModels') }}
            </el-button>
            <span v-if="probeResults[format]?.length" class="hint">{{
              i18ns.t('relay.discoveredModelCount', { count: probeResults[format].length })
            }}</span>
          </div>
          <div v-if="mode === 'provider' && probeResults[format]?.length" class="model-results">
            <el-checkbox-group v-model="selectedProbeModels[format]">
              <el-checkbox
                v-for="model in probeResults[format]"
                :key="model.id"
                :value="model.pricingModel || model.id"
                :disabled="!model.matched"
              >
                <span>{{ model.id }}</span>
                <el-tag v-if="model.matched" size="small" type="success">{{
                  model.pricingModel
                }}</el-tag>
                <el-tag v-else size="small" type="info">{{
                  i18ns.t('relay.unmatchedModel')
                }}</el-tag>
              </el-checkbox>
            </el-checkbox-group>
            <el-button
              size="small"
              type="success"
              :disabled="!selectedProbeModels[format].length"
              @click="$emit('add-probe-models', format)"
            >
              {{ i18ns.t('relay.addMatchedModels') }}
            </el-button>
          </div>
        </el-form-item>
      </template>

      <el-divider data-section="parameters" content-position="left">{{
        i18ns.t('relay.channelSettings')
      }}</el-divider>
      <el-form-item :label="i18ns.t('relay.channelMultiplier')">
        <el-input-number
          v-model="editorForm.multiplier"
          :min="0.000001"
          :step="0.000001"
          :precision="6"
        />
        <span class="hint inline-hint">{{ i18ns.t('relay.channelMultiplierHelp') }}</span>
      </el-form-item>
      <el-form-item :label="i18ns.t('relay.inputTokensIncludeCacheRead')">
        <el-switch v-model="editorForm.inputTokensIncludeCacheRead" />
        <div class="hint">{{ i18ns.t('relay.inputTokensIncludeCacheReadHelp') }}</div>
      </el-form-item>

      <el-divider data-section="providers" content-position="left">{{
        i18ns.t('relay.providers')
      }}</el-divider>
      <el-alert
        type="warning"
        :closable="false"
        :title="i18ns.t('relay.providerCommissionWarning')"
        class="mb-3"
      />
      <RelayProviderShareEditor
        :providers="editorForm.providers"
        @update:providers="$emit('update-providers', $event)"
      />

      <el-divider data-section="mapping" content-position="left">{{
        i18ns.t('relay.modelMappingSection')
      }}</el-divider>
      <div v-for="(mapping, index) in editorForm.mappings" :key="index" class="mapping-row">
        <el-input v-model="mapping.source" :placeholder="i18ns.t('relay.mappingSource')" />
        <el-input v-model="mapping.target" :placeholder="i18ns.t('relay.mappingTarget')" />
        <el-button
          text
          type="danger"
          :icon="Delete"
          @click="editorForm.mappings.splice(index, 1)"
        />
      </div>
      <el-button
        plain
        size="small"
        :icon="Plus"
        @click="editorForm.mappings.push({ source: '', target: '' })"
        >{{ i18ns.t('relay.mappingAdd') }}</el-button
      >

      <el-divider data-section="time-rules" content-position="left">{{
        i18ns.t('relay.timeRules')
      }}</el-divider>
      <div
        v-for="(rule, index) in editorForm.timePeriodMultipliers"
        :key="index"
        class="rule-row time-rule-row"
      >
        <el-input v-model="rule.name" :placeholder="i18ns.t('relay.timeRuleName')" />
        <el-input v-model="rule.dayOfWeek" :placeholder="i18ns.t('relay.timeRuleDays')" />
        <el-time-picker v-model="rule.startTime" value-format="HH:mm" />
        <el-time-picker v-model="rule.endTime" value-format="HH:mm" />
        <el-input-number v-model="rule.multiplier" :min="0.01" :step="0.01" :precision="6" />
        <el-switch v-model="rule.enabled" />
        <el-button
          text
          type="danger"
          :icon="Delete"
          @click="editorForm.timePeriodMultipliers.splice(index, 1)"
        />
      </div>
      <el-button plain size="small" :icon="Plus" @click="$emit('add-time-rule')">{{
        i18ns.t('relay.timeRuleAdd')
      }}</el-button>

      <el-divider data-section="context-rules" content-position="left">{{
        i18ns.t('relay.contextRules')
      }}</el-divider>
      <div
        v-for="(rule, index) in editorForm.contextLengthMultipliers"
        :key="index"
        class="rule-row context-rule-row"
      >
        <el-input v-model="rule.name" :placeholder="i18ns.t('relay.contextRuleName')" />
        <el-input-number v-model="rule.minTokens" :min="0" :step="1000" />
        <el-input-number v-model="rule.multiplier" :min="0.01" :step="0.01" :precision="6" />
        <el-switch v-model="rule.enabled" />
        <el-button
          text
          type="danger"
          :icon="Delete"
          @click="editorForm.contextLengthMultipliers.splice(index, 1)"
        />
      </div>
      <el-button plain size="small" :icon="Plus" @click="$emit('add-context-rule')">{{
        i18ns.t('relay.contextRuleAdd')
      }}</el-button>
    </el-form>
    <template #footer>
      <div class="relay-channel-editor-drawer__footer">
        <el-button @click="close">{{ i18ns.t('cancel') }}</el-button>
        <el-button type="primary" :loading="submitting" @click="$emit('save')">{{
          submitMode === 'change'
            ? i18ns.t('relay.submitChangeRequest')
            : mode === 'provider'
              ? i18ns.t('relay.submitChannel')
              : i18ns.t('save')
        }}</el-button>
      </div>
    </template>
  </el-drawer>
</template>

<script setup lang="ts">
import { computed, type PropType } from 'vue'
import type { RelayConfiguredRequestFormat, RelayUpstreamFormat } from '@quyan/shared'
import { Delete, Plus, Search } from '@element-plus/icons-vue'
import { i18ns } from '@/locales'
import { usePageDevice } from '@/composables/usePageDevice'
import RelayProviderShareEditor from './RelayProviderShareEditor.vue'
import type {
  RelayChannelProviderConfigRequest,
  RelayChannelUpstreamModelDto,
  TimePeriodMultiplierRule,
  ContextLengthMultiplierRule,
} from '@/client/types.gen'

export type StandaloneChannelFormState = {
  name: string
  formats: RelayConfiguredRequestFormat[]
  urls: Record<RelayUpstreamFormat, string>
  keys: Record<RelayUpstreamFormat, string>
  hasKeys: Record<RelayUpstreamFormat, boolean>
  keyTouched?: Record<RelayUpstreamFormat, boolean>
  multiplier: number
  inputTokensIncludeCacheRead: boolean
  allowedModels: string[]
  restrictModels?: boolean
  providers: RelayChannelProviderConfigRequest[]
  mappings: Array<{ source: string; target: string }>
  timePeriodMultipliers: TimePeriodMultiplierRule[]
  contextLengthMultipliers: ContextLengthMultiplierRule[]
}

type UpstreamFormat = RelayUpstreamFormat

const props = defineProps({
  modelValue: { type: Boolean, required: true },
  form: { type: Object as PropType<StandaloneChannelFormState>, required: true },
  mode: { type: String as PropType<'management' | 'provider'>, required: true },
  submitMode: { type: String as PropType<'submit' | 'change'>, default: 'submit' },
  submitting: { type: Boolean, default: false },
  modelOptions: {
    type: Array as PropType<Array<{ label: string; value: string; disabled?: boolean }>>,
    default: () => [],
  },
  probeLoading: {
    type: Object as PropType<Record<'openai' | 'anthropic' | 'gemini', boolean>>,
    default: () => ({ openai: false, anthropic: false, gemini: false }),
  },
  probeResults: {
    type: Object as PropType<
      Record<'openai' | 'anthropic' | 'gemini', RelayChannelUpstreamModelDto[]>
    >,
    default: () => ({ openai: [], anthropic: [], gemini: [] }),
  },
  selectedProbeModels: {
    type: Object as PropType<Record<'openai' | 'anthropic' | 'gemini', string[]>>,
    default: () => ({ openai: [], anthropic: [], gemini: [] }),
  },
})
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  save: []
  probe: [format: 'openai' | 'anthropic' | 'gemini']
  'add-probe-models': [format: 'openai' | 'anthropic' | 'gemini']
  'update-providers': [value: RelayChannelProviderConfigRequest[]]
  'add-time-rule': []
  'add-context-rule': []
  'key-touched': [format: 'openai' | 'anthropic' | 'gemini']
}>()
const { isDesktop } = usePageDevice()
const open = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
})
const editorForm = computed(() => props.form)
const upstreamFormats = computed<UpstreamFormat[]>(
  () =>
    Array.from(
      new Set(
        editorForm.value.formats.map((format) =>
          format.startsWith('openai-') ? 'openai' : format,
        ),
      ),
    ) as UpstreamFormat[],
)
const title = computed(() =>
  props.mode === 'provider'
    ? props.submitMode === 'change'
      ? i18ns.t('relay.submitChangeRequest')
      : i18ns.t('relay.submitChannel')
    : i18ns.t('relay.editChannel'),
)
const modelOptions = computed(() => props.modelOptions)
const probeLoading = props.probeLoading
const probeResults = props.probeResults
const selectedProbeModels = props.selectedProbeModels
const close = () => emit('update:modelValue', false)
const markKeyTouched = (format: 'openai' | 'anthropic' | 'gemini') => emit('key-touched', format)
</script>

<style scoped lang="scss">
.relay-channel-editor-drawer :deep(.el-drawer__body) {
  padding: 0;
  overflow: hidden;
}
.standalone-form {
  height: 100%;
  overflow-y: auto;
  padding: 20px 24px;
}
.full-width {
  width: 100%;
}
.hint {
  margin-top: 6px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.5;
}
.inline-hint {
  display: inline-block;
  margin-inline-start: 12px;
}
.model-toggle {
  display: block;
  margin-bottom: 10px;
}
.probe-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
}
.model-results {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 10px;
  padding: 12px;
  border-radius: 8px;
  background: var(--el-fill-color-light);
}
.model-results :deep(.el-checkbox-group) {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  gap: 8px;
}
.mapping-row,
.rule-row {
  display: grid;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}
.mapping-row {
  grid-template-columns: 1fr 1fr auto;
}
.time-rule-row {
  grid-template-columns: 1.2fr 1fr 1fr 1fr 120px 70px auto;
}
.context-rule-row {
  grid-template-columns: 1.5fr 1fr 120px 70px auto;
}
.relay-channel-editor-drawer__footer {
  display: flex;
  justify-content: flex-start;
  gap: 8px;
  width: 100%;
}
@media (max-width: 768px) {
  .standalone-form {
    padding: 14px;
  }
  .mapping-row,
  .rule-row {
    grid-template-columns: 1fr;
  }
}
</style>
