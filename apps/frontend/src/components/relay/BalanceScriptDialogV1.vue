<template>
  <el-dialog
    :model-value="modelValue"
    :title="i18ns.t('relay.balanceScriptDialogTitle') + ' (v1)'"
    :width="isDesktop ? '720px' : '94%'"
    class="relay-token-dialog v1-balance-script-dialog"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="v1-balance-script-dialog__body">
      <el-alert
        type="warning"
        :closable="false"
        show-icon
        class="v1-balance-script-dialog__alert"
        :title="i18ns.t('relay.v1ApiDeprecatedWarning')"
      />

      <div v-if="token" class="v1-balance-script-dialog__token">
        <span class="meta-label">{{ i18ns.t('relay.tokenName') }}</span>
        <span class="v1-balance-script-dialog__token-name">
          {{ token.name || i18ns.t('relay.unnamedToken') }}
        </span>
      </div>

      <el-form :model="settings" label-width="140px" label-position="top">
        <el-row :gutter="12">
          <el-col :xs="24" :sm="12">
            <el-form-item :label="i18ns.t('relay.balanceScriptExtraLayout')">
              <el-radio-group v-model="settings.extraLayout">
                <el-radio-button label="inline" :value="'inline'">
                  {{ i18ns.t('relay.balanceScriptLayoutInline') }}
                </el-radio-button>
                <el-radio-button label="multiline" :value="'multiline'">
                  {{ i18ns.t('relay.balanceScriptLayoutMultiline') }}
                </el-radio-button>
              </el-radio-group>
            </el-form-item>
          </el-col>
          <el-col :xs="24" :sm="12">
            <el-form-item :label="i18ns.t('relay.balanceScriptDecimalPlaces')">
              <el-segmented v-model="settings.decimalPlaces" :options="decimalOptions" block />
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item :label="i18ns.t('relay.balanceScriptHardcodeKey')">
          <el-switch v-model="settings.hardcodeKey" />
        </el-form-item>

        <div class="v1-balance-script-metric-grid">
          <div class="v1-balance-script-metric-card">
            <div class="v1-balance-script-metric-card__header">
              <div>
                <div class="v1-balance-script-metric-card__title">
                  {{ i18ns.t('relay.balanceScriptShowRequestCount') }}
                </div>
                <div class="v1-balance-script-metric-card__subtitle">
                  {{ i18ns.t('relay.balanceScriptRequestCountShort') }}
                </div>
              </div>
              <el-switch v-model="settings.requestCount.enabled" />
            </div>
            <el-form-item
              :label="i18ns.t('relay.balanceScriptNumberFormat')"
              class="v1-balance-script-metric-card__control"
            >
              <el-select
                v-model="settings.requestCount.format"
                :disabled="!settings.requestCount.enabled"
              >
                <el-option
                  v-for="option in metricFormatOptions"
                  :key="`req-${option.value}`"
                  :label="option.label"
                  :value="option.value"
                />
              </el-select>
            </el-form-item>
          </div>

          <div class="v1-balance-script-metric-card">
            <div class="v1-balance-script-metric-card__header">
              <div>
                <div class="v1-balance-script-metric-card__title">
                  {{ i18ns.t('relay.balanceScriptShowTotalTokens') }}
                </div>
                <div class="v1-balance-script-metric-card__subtitle">
                  {{ i18ns.t('relay.balanceScriptTotalTokensShort') }}
                </div>
              </div>
              <el-switch v-model="settings.totalTokens.enabled" />
            </div>
            <el-form-item
              :label="i18ns.t('relay.balanceScriptNumberFormat')"
              class="v1-balance-script-metric-card__control"
            >
              <el-select
                v-model="settings.totalTokens.format"
                :disabled="!settings.totalTokens.enabled"
              >
                <el-option
                  v-for="option in metricFormatOptions"
                  :key="`tok-${option.value}`"
                  :label="option.label"
                  :value="option.value"
                />
              </el-select>
            </el-form-item>
          </div>
        </div>

        <el-form-item :label="i18ns.t('relay.balanceScriptPreview')">
          <el-input :model-value="scriptPreview" type="textarea" :rows="12" readonly />
        </el-form-item>
      </el-form>
    </div>

    <template #footer>
      <div class="v1-balance-script-dialog__footer">
        <el-button @click="resetSettings">
          {{ i18ns.t('relay.balanceScriptReset') }}
        </el-button>
        <div class="v1-balance-script-dialog__footer-actions">
          <el-button @click="emit('update:modelValue', false)">
            {{ i18ns.t('cancel') }}
          </el-button>
          <el-button type="primary" @click="copyScript">
            {{ i18ns.t('relay.exportToCcswitch') }}
          </el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { i18ns } from '@/locales'
import { ElMessage } from 'element-plus'
import { usePageDevice } from '@/composables/usePageDevice'
import {
  buildV1CcswitchBalanceScript,
  DEFAULT_V1_BALANCE_SCRIPT_SETTINGS,
  type BalanceScriptMetricFormat,
} from '@/constant/strings'
import type { RelayTokenDto } from '@/client/types.gen'

const props = defineProps<{
  modelValue: boolean
  token: RelayTokenDto | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const { isDesktop } = usePageDevice()

type V1Settings = {
  extraLayout: 'inline' | 'multiline'
  decimalPlaces: number
  hardcodeUrlAndKey: boolean
  hardcodeKey: boolean
  requestCount: { enabled: boolean; format: BalanceScriptMetricFormat }
  totalTokens: { enabled: boolean; format: BalanceScriptMetricFormat }
}

const settings = ref<V1Settings>({
  ...DEFAULT_V1_BALANCE_SCRIPT_SETTINGS,
  requestCount: { ...DEFAULT_V1_BALANCE_SCRIPT_SETTINGS.requestCount },
  totalTokens: { ...DEFAULT_V1_BALANCE_SCRIPT_SETTINGS.totalTokens },
})

const decimalOptions = [0, 1, 2, 3, 4]

const metricFormatOptions = computed(() => [
  { value: 'exact' as const, label: i18ns.t('relay.balanceScriptFormatExact') },
  { value: 'smart' as const, label: i18ns.t('relay.balanceScriptFormatSmart') },
  { value: 'k' as const, label: i18ns.t('relay.balanceScriptFormatK') },
  { value: 'm' as const, label: i18ns.t('relay.balanceScriptFormatM') },
])

const scriptPreview = computed(() => {
  if (!props.token) return ''
  return buildV1CcswitchBalanceScript(props.token.token, {
    extraLayout: settings.value.extraLayout,
    decimalPlaces: settings.value.decimalPlaces,
    hardcodeUrlAndKey: settings.value.hardcodeUrlAndKey,
    hardcodeKey: settings.value.hardcodeKey,
    requestCount: {
      enabled: settings.value.requestCount.enabled,
      format: settings.value.requestCount.format,
    },
    totalTokens: {
      enabled: settings.value.totalTokens.enabled,
      format: settings.value.totalTokens.format,
    },
  })
})

const resetSettings = () => {
  settings.value = {
    ...DEFAULT_V1_BALANCE_SCRIPT_SETTINGS,
    requestCount: { ...DEFAULT_V1_BALANCE_SCRIPT_SETTINGS.requestCount },
    totalTokens: { ...DEFAULT_V1_BALANCE_SCRIPT_SETTINGS.totalTokens },
  }
}

const copyScript = async () => {
  if (!props.token) return
  try {
    await navigator.clipboard.writeText(scriptPreview.value)
    emit('update:modelValue', false)
    ElMessage.success(i18ns.t('relay.exportToCcswitchSuccess'))
  } catch {
    ElMessage.error(i18ns.t('relay.exportToCcswitchFailed'))
  }
}
</script>

<style scoped lang="scss">
.v1-balance-script-dialog__body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.v1-balance-script-dialog__alert {
  margin-bottom: 4px;
}

.v1-balance-script-dialog__token {
  font-size: 14px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.v1-balance-script-dialog__token-name {
  font-weight: 600;
  word-break: break-all;
}

.v1-balance-script-metric-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.v1-balance-script-metric-card {
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
  padding: 12px;
}

.v1-balance-script-metric-card__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.v1-balance-script-metric-card__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  line-height: 1.4;
}

.v1-balance-script-metric-card__subtitle {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  margin-top: 2px;
}

.v1-balance-script-metric-card__control {
  margin-bottom: 0;
}

.v1-balance-script-dialog__footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.v1-balance-script-dialog__footer-actions {
  display: flex;
  gap: 8px;
}
</style>
