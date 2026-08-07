<template>
  <el-drawer
    direction="rtl"
    size="min(760px, 94vw)"
    v-model="open"
    :title="
      mode === 'submit' ? i18ns.t('relay.submitChannel') : i18ns.t('relay.submitChangeRequest')
    "
    class="relay-config-drawer"
  >
    <el-alert
      v-if="mode === 'change'"
      type="info"
      :closable="false"
      :title="i18ns.t('relay.changeRequestReviewOnly')"
      class="mb-4"
    />
    <div class="relay-config-drawer__content">
      <el-form :model="form" label-position="top" class="provider-form">
        <el-collapse v-model="expandedSections">
          <el-collapse-item name="formats" :title="i18ns.t('relay.formatModelRestrictions')">
            <el-form-item :label="i18ns.t('relay.channelName')" required
              ><el-input v-model="form.name"
            /></el-form-item>
            <el-form-item :label="i18ns.t('relay.allowedFormats')"
              ><el-checkbox-group v-model="form.formats"
                ><el-checkbox value="openai">OpenAI</el-checkbox
                ><el-checkbox value="anthropic">Anthropic</el-checkbox
                ><el-checkbox value="gemini">Gemini</el-checkbox></el-checkbox-group
              ></el-form-item
            >
            <el-form-item :label="i18ns.t('relay.allowedModelsChannel')"
              ><el-select
                v-model="form.allowedModels"
                multiple
                filterable
                allow-create
                default-first-option
                class="full-width"
                :placeholder="i18ns.t('relay.allowedModelsManualPlaceholder')"
                ><el-option
                  v-for="model in form.allowedModels"
                  :key="model"
                  :label="model"
                  :value="model"
              /></el-select>
              <div class="hint">{{ i18ns.t('relay.allowedModelsChannelHelp') }}</div></el-form-item
            >
          </el-collapse-item>
          <el-collapse-item name="upstreams" :title="i18ns.t('relay.upstreamSettings')">
            <template v-for="format in form.formats" :key="format"
              ><div class="upstream-block">
                <h4>{{ format.toUpperCase() }}</h4>
                <el-form-item :label="`${format} URL`" required
                  ><el-input v-model="form.urls[format]" /></el-form-item
                ><el-form-item :label="i18ns.t('relay.apiKey')" required
                  ><el-input
                    v-model="form.keys[format]"
                    type="password"
                    show-password
                    :placeholder="
                      form.hasKeys[format] ? i18ns.t('relay.apiKeyReplacePlaceholder') : ''
                    "
                  />
                  <div v-if="form.hasKeys[format]" class="hint">
                    {{
                      mode === 'change'
                        ? i18ns.t('relay.credentialRetainHelp')
                        : i18ns.t('relay.apiKeyConfigured')
                    }}
                  </div></el-form-item
                >
                <div class="probe-row">
                  <el-button
                    size="small"
                    :loading="probeLoading[format]"
                    :icon="Search"
                    @click="$emit('probe', format)"
                    >{{ i18ns.t('relay.discoverModels') }}</el-button
                  ><span v-if="probeResults[format]" class="hint">{{
                    i18ns.t('relay.discoveredModelCount', { count: probeResults[format].length })
                  }}</span>
                </div>
                <div v-if="probeResults[format]?.length" class="model-results">
                  <el-checkbox-group v-model="selectedProbeModels[format]"
                    ><el-checkbox
                      v-for="model in probeResults[format]"
                      :key="model.id"
                      :value="model.pricingModel || model.id"
                      :disabled="!model.matched"
                      ><span>{{ model.id }}</span
                      ><el-tag v-if="model.matched" size="small" type="success">{{
                        model.pricingModel
                      }}</el-tag
                      ><el-tag v-else size="small" type="info">{{
                        i18ns.t('relay.unmatchedModel')
                      }}</el-tag></el-checkbox
                    ></el-checkbox-group
                  ><el-button
                    size="small"
                    type="success"
                    :disabled="!selectedProbeModels[format].length"
                    @click="$emit('add-probe-models', format)"
                    >{{ i18ns.t('relay.addMatchedModels') }}</el-button
                  >
                </div>
              </div></template
            >
          </el-collapse-item>
          <el-collapse-item name="parameters" :title="i18ns.t('relay.channelParameters')"
            ><el-form-item :label="i18ns.t('relay.channelMultiplier')"
              ><el-input-number
                v-model="form.multiplier"
                :min="0.000001"
                :step="0.01"
                :precision="6" /></el-form-item
            ><el-form-item :label="i18ns.t('relay.inputTokensIncludeCacheRead')"
              ><el-switch v-model="form.inputTokensIncludeCacheRead" />
              <div class="hint">
                {{ i18ns.t('relay.inputTokensIncludeCacheReadHelp') }}
              </div></el-form-item
            ></el-collapse-item
          >
          <el-collapse-item name="providers" :title="i18ns.t('relay.providers')">
            <el-alert
              type="warning"
              :closable="false"
              :title="i18ns.t('relay.providerCommissionWarning')"
              class="mb-3"
            />
            <RelayProviderShareEditor
              :providers="form.providers"
              :user-options="providerUserOptions"
              :users-loading="providerUsersLoading"
              @update:providers="$emit('update-providers', $event)"
              @search-users="$emit('search-provider-users', $event)"
            />
          </el-collapse-item>
          <el-collapse-item name="mapping" :title="i18ns.t('relay.modelMappingSection')"
            ><div v-for="(mapping, index) in form.mappings" :key="index" class="mapping-row">
              <el-input
                v-model="mapping.source"
                :placeholder="i18ns.t('relay.mappingSource')"
              /><el-input
                v-model="mapping.target"
                :placeholder="i18ns.t('relay.mappingTarget')"
              /><el-button
                text
                type="danger"
                :icon="Delete"
                @click="form.mappings.splice(index, 1)"
              />
            </div>
            <el-button
              plain
              size="small"
              :icon="Plus"
              @click="form.mappings.push({ source: '', target: '' })"
              >{{ i18ns.t('relay.mappingAdd') }}</el-button
            ></el-collapse-item
          >
          <el-collapse-item name="time" :title="i18ns.t('relay.timeRules')"
            ><div v-for="(rule, index) in form.timePeriodMultipliers" :key="index" class="rule-row">
              <el-input v-model="rule.name" :placeholder="i18ns.t('relay.timeRuleName')" /><el-input
                v-model="rule.dayOfWeek"
                :placeholder="i18ns.t('relay.timeRuleDays')"
              /><el-time-picker v-model="rule.startTime" value-format="HH:mm" /><el-time-picker
                v-model="rule.endTime"
                value-format="HH:mm"
              /><el-input-number
                v-model="rule.multiplier"
                :min="0.01"
                :step="0.01"
                :precision="6"
              /><el-switch v-model="rule.enabled" /><el-button
                text
                type="danger"
                :icon="Delete"
                @click="form.timePeriodMultipliers.splice(index, 1)"
              />
            </div>
            <el-button plain size="small" :icon="Plus" @click="$emit('add-time-rule')">{{
              i18ns.t('relay.timeRuleAdd')
            }}</el-button></el-collapse-item
          >
          <el-collapse-item name="context" :title="i18ns.t('relay.contextRules')"
            ><div
              v-for="(rule, index) in form.contextLengthMultipliers"
              :key="index"
              class="rule-row"
            >
              <el-input
                v-model="rule.name"
                :placeholder="i18ns.t('relay.contextRuleName')"
              /><el-input-number v-model="rule.minTokens" :min="0" :step="1000" /><el-input-number
                v-model="rule.multiplier"
                :min="0.01"
                :step="0.01"
                :precision="6"
              /><el-switch v-model="rule.enabled" /><el-button
                text
                type="danger"
                :icon="Delete"
                @click="form.contextLengthMultipliers.splice(index, 1)"
              />
            </div>
            <el-button plain size="small" :icon="Plus" @click="$emit('add-context-rule')">{{
              i18ns.t('relay.contextRuleAdd')
            }}</el-button></el-collapse-item
          >
        </el-collapse>
      </el-form>
    </div>
    <template #footer>
      <div class="relay-config-drawer__footer">
        <el-button @click="close">{{ i18ns.t('cancel') }}</el-button>
        <el-button type="primary" :loading="submitting" @click="$emit('save')">
          {{
            mode === 'submit'
              ? i18ns.t('relay.submitChannel')
              : i18ns.t('relay.submitChangeRequest')
          }}
        </el-button>
      </div>
    </template>
  </el-drawer>
</template>

<script setup lang="ts">
import { computed, ref, type PropType } from 'vue'
import { Delete, Plus, Search } from '@element-plus/icons-vue'
import { i18ns } from '@/locales'
import RelayProviderShareEditor, {
  type RelayProviderUserOption,
} from './RelayProviderShareEditor.vue'
import type {
  RelayChannelUpstreamModelDto,
  RelayChannelProviderConfigRequest,
  TimePeriodMultiplierRule,
  ContextLengthMultiplierRule,
} from '@/client/types.gen'

export type RelayChannelConfigFormState = {
  name: string
  formats: Array<'openai' | 'anthropic' | 'gemini'>
  urls: Record<'openai' | 'anthropic' | 'gemini', string>
  keys: Record<'openai' | 'anthropic' | 'gemini', string>
  hasKeys: Record<'openai' | 'anthropic' | 'gemini', boolean>
  multiplier: number
  inputTokensIncludeCacheRead: boolean
  allowedModels: string[]
  providers: RelayChannelProviderConfigRequest[]
  mappings: Array<{ source: string; target: string }>
  timePeriodMultipliers: TimePeriodMultiplierRule[]
  contextLengthMultipliers: ContextLengthMultiplierRule[]
}
const props = defineProps({
  modelValue: { type: Boolean, required: true },
  form: { type: Object as PropType<RelayChannelConfigFormState>, required: true },
  mode: { type: String as PropType<'submit' | 'change'>, required: true },
  submitting: { type: Boolean, default: false },
  probeLoading: {
    type: Object as PropType<Record<'openai' | 'anthropic' | 'gemini', boolean>>,
    required: true,
  },
  probeResults: {
    type: Object as PropType<
      Record<'openai' | 'anthropic' | 'gemini', RelayChannelUpstreamModelDto[]>
    >,
    required: true,
  },
  selectedProbeModels: {
    type: Object as PropType<Record<'openai' | 'anthropic' | 'gemini', string[]>>,
    required: true,
  },
  providerUserOptions: { type: Array as PropType<RelayProviderUserOption[]>, default: () => [] },
  providerUsersLoading: { type: Boolean, default: false },
})
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  save: []
  probe: [format: 'openai' | 'anthropic' | 'gemini']
  'add-probe-models': [format: 'openai' | 'anthropic' | 'gemini']
  'update-providers': [value: RelayChannelProviderConfigRequest[]]
  'search-provider-users': [keyword: string]
  'add-time-rule': []
  'add-context-rule': []
}>()
const open = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})
const form = props.form
const mode = computed(() => props.mode)
const probeLoading = props.probeLoading
const probeResults = props.probeResults
const selectedProbeModels = props.selectedProbeModels
const expandedSections = ref(['formats', 'upstreams', 'parameters', 'providers'])
const close = () => emit('update:modelValue', false)
</script>

<style scoped lang="scss">
.relay-config-drawer :deep(.el-drawer__body) {
  padding: 0;
  overflow: hidden;
}
.relay-config-drawer__content {
  height: 100%;
  overflow: auto;
  padding: 20px 24px;
}
.relay-config-drawer__footer {
  display: flex;
  justify-content: flex-start;
  gap: 8px;
  width: 100%;
}
.provider-form {
  min-width: 0;
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
.upstream-block {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  padding: 14px;
  margin-bottom: 12px;
  background: var(--el-fill-color-blank);
}
.upstream-block h4 {
  margin: 0 0 12px;
  color: var(--el-text-color-primary);
  font-size: 14px;
}
.probe-row {
  display: flex;
  align-items: center;
  gap: 10px;
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
.model-results :deep(.el-checkbox) {
  margin-right: 0;
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
.rule-row {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.relay-config-drawer :deep(.el-collapse-item__header) {
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}
@media (max-width: 768px) {
  .relay-config-drawer__content {
    padding: 14px;
  }
  .mapping-row,
  .rule-row {
    grid-template-columns: 1fr;
  }
  .relay-config-drawer :deep(.el-drawer) {
    width: 96% !important;
  }
}
</style>
