<template>
  <el-dialog
    :model-value="modelValue"
    :title="i18ns.t('relay.balanceScriptDialogTitle')"
    :width="isDesktop ? '78vw' : '96%'"
    class="relay-token-dialog balance-script-dialog"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="balance-script-dialog__body">
      <div v-if="token" class="balance-script-dialog__token">
        <div class="balance-script-dialog__token-main">
          <span class="balance-script-dialog__token-label">{{ i18ns.t('relay.tokenName') }}</span>
          <span class="balance-script-dialog__token-name">
            {{ token.name || i18ns.t('relay.unnamedToken') }}
          </span>
        </div>
        <div class="balance-script-dialog__token-tags">
          <el-tag size="small">{{ balanceScriptCurrentRangeLabel }}</el-tag>
          <el-tag size="small" type="info"
            >{{ balanceScriptEnabledFieldCount }}
            {{ i18ns.t('relay.balanceScriptSelectedFields') }}</el-tag
          >
        </div>
      </div>

      <div class="balance-script-dialog__v1-link">
        <el-link type="primary" :underline="false" @click="emit('switchToV1')">
          <span class="balance-script-dialog__v1-link-text">{{
            i18ns.t('relay.v1SwitchLink')
          }}</span>
          <el-tag size="small" type="danger" effect="plain" class="deprecated-tag"
            >deprecated</el-tag
          >
          <el-icon class="balance-script-dialog__v1-link-icon"><ArrowRight /></el-icon>
        </el-link>
      </div>

      <div class="balance-script-workbench">
        <div class="balance-script-workbench__main">
          <el-form
            :model="balanceScriptSettings"
            label-position="top"
            class="balance-script-config"
          >
            <el-card shadow="never" class="balance-script-panel balance-script-panel--main">
              <div class="balance-script-panel__content balance-script-panel__content--main">
                <div class="balance-script-config-sections">
                  <div class="balance-script-config-section balance-script-config-section--display">
                    <div class="balance-script-config-row balance-script-config-row--display">
                      <el-form-item
                        :label="i18ns.t('relay.balanceScriptExtraLayout')"
                        class="balance-script-config-cell"
                      >
                        <el-radio-group v-model="balanceScriptSettings.extraLayout" size="small">
                          <el-radio-button label="inline" :value="'inline'">
                            {{ i18ns.t('relay.balanceScriptLayoutInline') }}
                          </el-radio-button>
                          <el-radio-button label="multiline" :value="'multiline'">
                            {{ i18ns.t('relay.balanceScriptLayoutMultiline') }}
                          </el-radio-button>
                        </el-radio-group>
                      </el-form-item>

                      <el-form-item
                        :label="i18ns.t('relay.balanceScriptDecimalPlaces')"
                        class="balance-script-config-cell"
                      >
                        <el-segmented
                          v-model="balanceScriptSettings.decimalPlaces"
                          :options="balanceScriptDecimalOptions"
                          block
                        />
                      </el-form-item>

                      <el-form-item
                        :label="i18ns.t('relay.balanceScriptHardcodedUsageEndpointSource')"
                        class="balance-script-config-cell"
                      >
                        <el-select v-model="balanceScriptHardcodeMode">
                          <el-option
                            v-for="option in balanceScriptHardcodedUsageEndpointSourceOptions"
                            :key="option.value"
                            :label="option.label"
                            :value="option.value"
                          />
                        </el-select>
                      </el-form-item>

                      <el-form-item
                        :label="i18ns.t('relay.balanceScriptHardcodeKey')"
                        class="balance-script-config-cell"
                      >
                        <el-switch v-model="balanceScriptSettings.hardcodeKey" />
                      </el-form-item>

                      <el-form-item
                        :label="i18ns.t('relay.balanceScriptGraphMetric')"
                        class="balance-script-config-cell"
                      >
                        <el-select v-model="balanceScriptSettings.unicodeGraph.metric">
                          <el-option
                            v-for="option in balanceScriptGraphMetricOptions"
                            :key="option.value"
                            :label="option.label"
                            :value="option.value"
                          />
                        </el-select>
                      </el-form-item>
                    </div>

                    <el-form-item
                      :label="i18ns.t('relay.balanceScriptTemplatePreset')"
                      class="balance-script-template-field"
                    >
                      <el-select
                        v-model="balanceScriptSettings.templatePreset"
                        @change="handleBalanceScriptTemplatePresetChange"
                      >
                        <el-option
                          v-for="option in balanceScriptTemplatePresetOptions"
                          :key="option.value"
                          :label="option.label"
                          :value="option.value"
                        />
                      </el-select>
                    </el-form-item>

                    <el-form-item
                      :label="i18ns.t('relay.balanceScriptExtraTemplate')"
                      class="balance-script-template-field"
                    >
                      <el-input
                        ref="balanceScriptTemplateInputRef"
                        v-model="balanceScriptSettings.extraTemplate"
                        type="textarea"
                        :rows="2"
                        :placeholder="i18ns.t('relay.balanceScriptExtraTemplatePlaceholder')"
                        @input="handleBalanceScriptTemplateInput"
                      />
                      <div class="balance-script-template-placeholders">
                        <span class="balance-script-template-placeholders__label">
                          {{ i18ns.t('relay.balanceScriptTemplateInsertHint') }}
                        </span>
                        <el-button
                          v-for="option in balanceScriptTemplatePlaceholderOptions"
                          :key="option.value"
                          size="small"
                          plain
                          :title="option.description"
                          @click="insertBalanceScriptTemplatePlaceholder(option.value)"
                        >
                          {{ option.label }}
                        </el-button>
                      </div>
                      <div class="balance-script-template-hint">
                        {{ i18ns.t('relay.balanceScriptExtraTemplateHint') }}
                      </div>
                    </el-form-item>
                  </div>
                </div>

                <div class="balance-script-range-row">
                  <div class="balance-script-range-panel">
                    <el-form-item
                      :label="i18ns.t('relay.balanceScriptTimeRangeMode')"
                      class="balance-script-range-panel__mode"
                    >
                      <el-radio-group
                        v-model="balanceScriptSettings.timeRangeMode"
                        class="balance-script-range-group"
                      >
                        <el-radio-button
                          v-for="option in balanceScriptTimeRangeModeOptions"
                          :key="option.value"
                          :label="option.value"
                          :value="option.value"
                        >
                          {{ option.label }}
                        </el-radio-button>
                      </el-radio-group>
                    </el-form-item>

                    <div
                      v-if="balanceScriptSettings.timeRangeMode !== 'lifetime'"
                      class="balance-script-range-panel__detail"
                    >
                      <div
                        v-if="balanceScriptSettings.timeRangeMode === 'customWindow'"
                        class="balance-script-inline-fields"
                      >
                        <el-form-item :label="i18ns.t('relay.balanceScriptWindowHours')">
                          <el-input-number
                            v-model="balanceScriptSettings.windowHours"
                            :min="0"
                            :max="24 * 30 * 12"
                            :step="1"
                            style="width: 100%"
                          />
                        </el-form-item>
                      </div>

                      <div
                        v-else-if="balanceScriptSettings.timeRangeMode === 'dailyReset'"
                        class="balance-script-reset-fields"
                      >
                        <div class="balance-script-inline-fields">
                          <el-form-item :label="i18ns.t('relay.balanceScriptResetInterval')">
                            <div style="display: flex; align-items: center; gap: 6px; width: 100%">
                              <span style="white-space: nowrap; flex-shrink: 0">{{
                                i18ns.t('relay.balanceScriptEveryPrefix')
                              }}</span>
                              <el-input-number
                                v-model="balanceScriptSettings.resetEvery"
                                :min="1"
                                :max="365"
                                :step="1"
                                controls-position="right"
                                style="flex: 0 0 90px"
                              />
                              <el-select
                                v-model="balanceScriptSettings.resetPeriod"
                                style="flex: 1"
                              >
                                <el-option
                                  v-for="opt in balanceScriptResetPeriodOptions"
                                  :key="opt.value"
                                  :label="opt.label"
                                  :value="opt.value"
                                />
                              </el-select>
                            </div>
                          </el-form-item>
                        </div>
                        <div
                          class="balance-script-inline-fields balance-script-inline-fields--double"
                        >
                          <el-form-item :label="i18ns.t('relay.balanceScriptResetAt')">
                            <el-time-picker
                              v-model="balanceScriptSettings.resetAt"
                              value-format="HH:mm"
                              format="HH:mm"
                              style="width: 100%"
                            />
                          </el-form-item>
                          <el-form-item :label="i18ns.t('relay.balanceScriptTimezoneOffset')">
                            <el-input-number
                              v-model="balanceScriptSettings.timezoneOffsetMinutes"
                              :min="-840"
                              :max="840"
                              :step="60"
                              style="width: 100%"
                            />
                          </el-form-item>
                        </div>
                        <div class="balance-script-inline-fields">
                          <el-form-item :label="balanceScriptResetAnchorLabel">
                            <el-date-picker
                              v-model="balanceScriptSettings.resetAnchorDate"
                              type="date"
                              value-format="YYYY-MM-DD"
                              format="YYYY-MM-DD"
                              style="width: 100%"
                            />
                          </el-form-item>
                        </div>
                      </div>

                      <div
                        v-else-if="balanceScriptSettings.timeRangeMode === 'customRange'"
                        class="balance-script-inline-fields"
                      >
                        <el-form-item :label="i18ns.t('relay.balanceScriptCustomRange')">
                          <el-date-picker
                            v-model="customDateRange"
                            type="datetimerange"
                            value-format="YYYY-MM-DDTHH:mm:ss.SSS[Z]"
                            format="YYYY-MM-DD HH:mm:ss"
                            :start-placeholder="i18ns.t('relay.balanceScriptCustomStartDate')"
                            :end-placeholder="i18ns.t('relay.balanceScriptCustomEndDate')"
                            style="width: 100%"
                          />
                        </el-form-item>
                        <el-form-item>
                          <el-text type="info" size="small">
                            {{ i18ns.t('relay.balanceScriptCustomRangeHint') }}
                          </el-text>
                        </el-form-item>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </el-card>
          </el-form>

          <el-card shadow="never" class="balance-script-panel balance-script-field-panel">
            <template #header>{{ i18ns.t('relay.balanceScriptSelectedFields') }}</template>
            <div class="balance-script-field-table">
              <el-table
                :data="balanceScriptFieldOptions"
                stripe
                size="small"
                height="100%"
                class="balance-script-field-table__el-table"
                :row-class-name="balanceScriptFieldTableRowClass"
              >
                <el-table-column :label="i18ns.t('relay.balanceScriptFieldName')" min-width="160">
                  <template #default="{ row: field }">
                    <el-tag
                      v-if="balanceScriptTemplateUsedFields.has(field.value)"
                      size="small"
                      type="success"
                      class="balance-script-field-row__badge"
                      >已选</el-tag
                    >
                    <span>{{ field.label }}</span>
                    <el-tooltip :content="field.tooltip" placement="top">
                      <el-icon class="balance-script-field-row__help"><QuestionFilled /></el-icon>
                    </el-tooltip>
                  </template>
                </el-table-column>
                <el-table-column :label="i18ns.t('relay.balanceScriptFieldShort')" width="80">
                  <template #default="{ row: field }">
                    <span class="balance-script-field-table__short-text">{{
                      field.shortLabel
                    }}</span>
                  </template>
                </el-table-column>
                <el-table-column :label="i18ns.t('relay.balanceScriptFieldFormat')" width="140">
                  <template #default="{ row: field }">
                    <el-select
                      :model-value="getFieldFormatValue(field)"
                      class="balance-script-field-row__format"
                      @update:model-value="
                        updateBalanceScriptFieldFormat(asBalanceScriptField(field).value, $event)
                      "
                    >
                      <el-option
                        v-for="option in getBalanceScriptFieldFormatOptions(
                          asBalanceScriptField(field),
                        )"
                        :key="`${field.value}-${option.value}`"
                        :label="option.label"
                        :value="option.value"
                      />
                    </el-select>
                  </template>
                </el-table-column>
                <el-table-column :label="i18ns.t('relay.balanceScriptFieldDecimals')" width="100">
                  <template #default="{ row: field }">
                    <el-input-number
                      v-if="asBalanceScriptField(field).kind === 'number'"
                      :model-value="getFieldDecimalsValue(field)"
                      class="balance-script-field-row__decimals"
                      :min="0"
                      :max="4"
                      :step="1"
                      controls-position="right"
                      size="small"
                      @update:model-value="
                        updateBalanceScriptFieldDecimals(asBalanceScriptField(field).value, $event)
                      "
                    />
                  </template>
                </el-table-column>
              </el-table>
            </div>
          </el-card>
        </div>

        <el-card shadow="never" class="balance-script-preview-panel">
          <template #header>{{ i18ns.t('relay.balanceScriptPreview') }}</template>
          <div class="balance-script-preview-panel__content">
            <div class="balance-script-preview-panel__meta">
              <el-tag size="small">{{ balanceScriptCurrentRangeLabel }}</el-tag>
              <el-tag size="small" type="info"
                >{{ balanceScriptEnabledFieldCount }}
                {{ i18ns.t('relay.balanceScriptSelectedFields') }}</el-tag
              >
            </div>

            <el-input :model-value="balanceScriptPreview" type="textarea" :rows="14" readonly />
          </div>
        </el-card>
      </div>
    </div>

    <template #footer>
      <div class="balance-script-dialog__footer">
        <div class="balance-script-dialog__footer-actions">
          <el-button @click="dismiss">{{ i18ns.t('cancel') }}</el-button>
          <el-button @click="resetBalanceScriptSettings">
            {{ i18ns.t('relay.balanceScriptReset') }}
          </el-button>
          <el-button type="primary" @click="copyConfiguredBalanceScript">
            {{ i18ns.t('relay.exportToCcswitch') }}
          </el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { ArrowRight, QuestionFilled } from '@element-plus/icons-vue'
import { i18ns } from '@/locales'
import { ElMessage } from 'element-plus'
import { usePageDevice } from '@/composables/usePageDevice'
import { copyTextWithFallback } from '@/utils/clipboard'
import { TypedLocalStorage } from '@/utils/typedLocalStorage'
import {
  BALANCE_SCRIPT_TEMPLATE_PRESETS,
  BALANCE_SCRIPT_FIELDS,
  buildRelayAiUsageEndpointUrl,
  buildRelayApiUsageEndpointUrl,
  buildCcswitchBalanceScript,
  buildRelayUsageEndpointUrl,
  DEFAULT_BALANCE_SCRIPT_SETTINGS,
  type BalanceScriptFieldKey,
  type BalanceScriptHardcodedUsageEndpointSource,
  type BalanceScriptMetricFormat,
  type BalanceScriptSettings,
  type BalanceScriptTemplatePreset,
} from '@/constant/strings'
import StorageKey from '@/constant/storagekey'
import type { RelayTokenDto } from '@/client/types.gen'

type BalanceScriptFieldOption = {
  value: BalanceScriptFieldKey
  label: string
  shortLabel: string
  tooltip: string
  kind: 'number' | 'date' | 'text'
  formatOptions: BalanceScriptMetricFormat[]
}

type BalanceScriptTemplatePlaceholderOption = {
  value: string
  label: string
  description: string
}

const props = defineProps<{
  modelValue: boolean
  token: RelayTokenDto | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  switchToV1: []
}>()

const { isDesktop } = usePageDevice()

const dismiss = () => emit('update:modelValue', false)

// ---- localStorage persistence ----
const BALANCE_SCRIPT_STORAGE_KEY = StorageKey.Relay.BALANCE_SCRIPT_SETTINGS

const cloneDefaultBalanceScriptSettings = (): BalanceScriptSettings =>
  JSON.parse(JSON.stringify(DEFAULT_BALANCE_SCRIPT_SETTINGS)) as BalanceScriptSettings

const normalizeBalanceScriptSettings = (value?: Partial<BalanceScriptSettings> | null) => {
  const fallback = cloneDefaultBalanceScriptSettings()
  const decimalPlaces = Number(value?.decimalPlaces)
  const safeDecimalPlaces = Number.isFinite(decimalPlaces)
    ? Math.min(Math.max(decimalPlaces, 0), 4)
    : fallback.decimalPlaces

  const BALANCE_SCRIPT_FIELD_FORMATS_BY_KIND: Record<string, BalanceScriptMetricFormat[]> = {
    number: ['exact', 'smart', 'k', 'm'],
    date: ['dateTime', 'dateOnly', 'iso', 'relative'],
    text: ['text', 'raw'],
  }

  const safeFieldFormats = Object.fromEntries(
    BALANCE_SCRIPT_FIELDS.map((field) => {
      const format = value?.fieldFormats?.[field]
      const kind = BALANCE_SCRIPT_FIELD_KINDS[field]
      const allowed =
        BALANCE_SCRIPT_ALLOWED_FORMATS[field] ?? BALANCE_SCRIPT_FIELD_FORMATS_BY_KIND[kind!] ?? []
      return [
        field,
        format && allowed.includes(format)
          ? format
          : kind === 'date'
            ? ('dateTime' as const)
            : kind === 'text'
              ? ('text' as const)
              : ('exact' as const),
      ]
    }),
  )

  const safeFieldDecimals = Object.fromEntries(
    BALANCE_SCRIPT_FIELDS.filter((field) => BALANCE_SCRIPT_FIELD_KINDS[field] === 'number').map(
      (field) => {
        const d = Number(value?.fieldDecimals?.[field])
        return [field, Number.isFinite(d) ? Math.min(Math.max(d, 0), 4) : safeDecimalPlaces]
      },
    ),
  )

  const safeUnicodeGraph = value?.unicodeGraph?.metric
    ? { metric: value.unicodeGraph.metric }
    : fallback.unicodeGraph

  return {
    ...fallback,
    ...value,
    decimalPlaces: safeDecimalPlaces,
    fieldFormats: safeFieldFormats as Partial<
      Record<BalanceScriptFieldKey, BalanceScriptMetricFormat>
    >,
    fieldDecimals: safeFieldDecimals as Partial<Record<BalanceScriptFieldKey, number>>,
    unicodeGraph: safeUnicodeGraph,
  }
}

const loadBalanceScriptSettings = (): BalanceScriptSettings => {
  const saved = TypedLocalStorage.get<BalanceScriptSettings>(BALANCE_SCRIPT_STORAGE_KEY)
  // Migration: use raw check for runtime localStorage JSON that may lack new properties
  const raw = saved as Record<string, unknown> | undefined
  if (
    raw &&
    typeof raw.hardcodeUrlAndKey === 'boolean' &&
    typeof raw.hardcodedUsageEndpointSource !== 'string'
  ) {
    raw.hardcodedUsageEndpointSource = 'off'
  }
  return normalizeBalanceScriptSettings(saved)
}

// ---- helpers ----
const BALANCE_SCRIPT_FIELD_KINDS: Record<string, 'number' | 'date' | 'text'> = {
  requestCount: 'number',
  totalTokens: 'number',
  requestTokens: 'number',
  responseTokens: 'number',
  totalSpend: 'number',
  usedQuota: 'number',
  remainingQuota: 'number',
  quotaLimit: 'number',
  cacheCreationTokens: 'number',
  cacheReadTokens: 'number',
  chargedAmount: 'number',
  coveredAmount: 'number',
  lastUsedAt: 'date',
  rangeLabel: 'text',
}

const BALANCE_SCRIPT_ALLOWED_FORMATS: Partial<Record<string, BalanceScriptMetricFormat[]>> = {
  lastUsedAt: ['dateTime', 'dateOnly', 'iso', 'relative', 'off'],
  rangeLabel: ['text', 'off'],
}

const getBalanceScriptFieldFormatOptions = (field: BalanceScriptFieldOption) =>
  field.formatOptions.map((value) => ({
    value,
    label: balanceScriptFormatOptionLabels.value[value],
  }))

// ---- state ----
const balanceScriptSettings = ref<BalanceScriptSettings>(loadBalanceScriptSettings())
const balanceScriptTemplateInputRef = ref<{
  textarea?: HTMLTextAreaElement
  focus?: () => void
} | null>(null)

// ---- computed ----
const balanceScriptFormatOptionLabels = computed<Record<BalanceScriptMetricFormat, string>>(() => ({
  off: i18ns.t('close'),
  exact: i18ns.t('relay.balanceScriptFormatExact'),
  smart: i18ns.t('relay.balanceScriptFormatSmart'),
  k: i18ns.t('relay.balanceScriptFormatK'),
  m: i18ns.t('relay.balanceScriptFormatM'),
  dateTime: i18ns.t('relay.balanceScriptFormatDateTime'),
  dateOnly: i18ns.t('relay.balanceScriptFormatDateOnly'),
  iso: i18ns.t('relay.balanceScriptFormatIso'),
  relative: i18ns.t('relay.balanceScriptFormatRelative'),
  text: i18ns.t('relay.balanceScriptFormatText'),
  raw: i18ns.t('relay.balanceScriptFormatRaw'),
}))

const balanceScriptTimeRangeModeOptions = computed(() => [
  { value: 'lifetime' as const, label: i18ns.t('relay.balanceScriptTimeRangeLifetime') },
  { value: 'customWindow' as const, label: i18ns.t('relay.balanceScriptTimeRangeCustomWindow') },
  { value: 'dailyReset' as const, label: i18ns.t('relay.balanceScriptTimeRangeDailyReset') },
  { value: 'customRange' as const, label: i18ns.t('relay.balanceScriptTimeRangeCustomRange') },
])

const balanceScriptResetPeriodOptions = computed(() => [
  { value: 'day' as const, label: i18ns.t('relay.balanceScriptResetPeriodDay') },
  { value: 'week' as const, label: i18ns.t('relay.balanceScriptResetPeriodWeek') },
  { value: 'month' as const, label: i18ns.t('relay.balanceScriptResetPeriodMonth') },
])

const balanceScriptResetAnchorLabel = computed(() =>
  balanceScriptSettings.value.resetPeriod === 'month'
    ? i18ns.t('relay.balanceScriptResetAnchorDateMonth')
    : i18ns.t('relay.balanceScriptResetAnchorDateGeneral'),
)

const balanceScriptTemplatePresetOptions = computed(() => [
  { value: 'compact' as const, label: i18ns.t('relay.balanceScriptTemplatePresetCompact') },
  { value: 'overview' as const, label: i18ns.t('relay.balanceScriptTemplatePresetOverview') },
  { value: 'usage' as const, label: i18ns.t('relay.balanceScriptTemplatePresetUsage') },
  { value: 'compare' as const, label: i18ns.t('relay.balanceScriptTemplatePresetCompare') },
  { value: 'tokens' as const, label: i18ns.t('relay.balanceScriptTemplatePresetTokens') },
  { value: 'quota' as const, label: i18ns.t('relay.balanceScriptTemplatePresetQuota') },
  { value: 'cost' as const, label: i18ns.t('relay.balanceScriptTemplatePresetCost') },
  { value: 'quotaCost' as const, label: i18ns.t('relay.balanceScriptTemplatePresetQuotaCost') },
  { value: 'debug' as const, label: i18ns.t('relay.balanceScriptTemplatePresetDebug') },
  { value: 'cache' as const, label: i18ns.t('relay.balanceScriptTemplatePresetCache') },
  { value: 'status' as const, label: i18ns.t('relay.balanceScriptTemplatePresetStatus') },
  { value: 'finance' as const, label: i18ns.t('relay.balanceScriptTemplatePresetFinance') },
  { value: 'tokenCost' as const, label: i18ns.t('relay.balanceScriptTemplatePresetTokenCost') },
  { value: 'requestOnly' as const, label: i18ns.t('relay.balanceScriptTemplatePresetRequestOnly') },
  { value: 'graphSimple' as const, label: i18ns.t('relay.balanceScriptTemplatePresetGraphSimple') },
  {
    value: 'costWithCache' as const,
    label: i18ns.t('relay.balanceScriptTemplatePresetCostWithCache'),
  },
  { value: 'minimal' as const, label: i18ns.t('relay.balanceScriptTemplatePresetMinimal') },
  { value: 'custom' as const, label: i18ns.t('relay.balanceScriptTemplatePresetCustom') },
])

const balanceScriptHardcodedUsageEndpointSourceOptions = computed(() => [
  { value: 'ai' as const, label: i18ns.t('relay.balanceScriptHardcodedUsageEndpointSourceAi') },
  { value: 'api' as const, label: i18ns.t('relay.balanceScriptHardcodedUsageEndpointSourceApi') },
  { value: 'off' as const, label: i18ns.t('relay.balanceScriptHardcodedUsageEndpointSourceOff') },
])

const balanceScriptHardcodeMode = computed<BalanceScriptHardcodedUsageEndpointSource>({
  get: () => balanceScriptSettings.value.hardcodedUsageEndpointSource,
  set: (val) => {
    balanceScriptSettings.value.hardcodedUsageEndpointSource = val
  },
})

const customDateRange = computed({
  get: () => {
    const start = balanceScriptSettings.value.customStartDate
    const end = balanceScriptSettings.value.customEndDate
    return [start || undefined, end || undefined] as [string, string] | [undefined, undefined]
  },
  set: ([start, end]: [string, string]) => {
    balanceScriptSettings.value.customStartDate = start
    balanceScriptSettings.value.customEndDate = end
  },
})

const balanceScriptFieldOptions = computed<BalanceScriptFieldOption[]>(() =>
  BALANCE_SCRIPT_FIELDS.map((key) => {
    const kind = BALANCE_SCRIPT_FIELD_KINDS[key] || 'number'
    const allowedFormatsForKey = BALANCE_SCRIPT_ALLOWED_FORMATS[key]
    const formatOptions =
      allowedFormatsForKey ??
      ((kind === 'date'
        ? (['dateTime', 'dateOnly', 'iso', 'relative'] as const)
        : kind === 'text'
          ? (['text', 'raw'] as const)
          : (['exact', 'smart', 'k', 'm'] as const)) as unknown as BalanceScriptMetricFormat[])
    const labelKey = `relay.balanceScript${key.charAt(0).toUpperCase() + key.slice(1)}`
    const shortLabelKey = `${labelKey}Short`
    return {
      value: key,
      label: i18ns.t(labelKey as any),
      shortLabel: i18ns.t(shortLabelKey as any),
      tooltip: i18ns.t(
        `relay.balanceScriptFieldTooltip${key.charAt(0).toUpperCase() + key.slice(1)}` as any,
      ),
      kind,
      formatOptions,
    }
  }),
)

const balanceScriptGraphMetricOptions = computed(() => [
  { value: 'off' as const, label: i18ns.t('relay.balanceScriptGraphMetricOff') },
  { value: 'quotaUsage' as const, label: i18ns.t('relay.balanceScriptGraphMetricQuotaUsage') },
  {
    value: 'remainingQuota' as const,
    label: i18ns.t('relay.balanceScriptGraphMetricRemainingQuota'),
  },
  { value: 'totalTokens' as const, label: i18ns.t('relay.balanceScriptGraphMetricTotalTokens') },
])

const balanceScriptDecimalOptions = [0, 1, 2, 3, 4]

const balanceScriptTemplatePlaceholderOptions = computed<BalanceScriptTemplatePlaceholderOption[]>(
  () => [
    ...balanceScriptFieldOptions.value.map((field) => ({
      value: `{{${field.value}}}`,
      label: field.shortLabel,
      description: field.tooltip,
    })),
    { value: '{{total}}', label: 'total', description: 'Total quota' },
    { value: '{{used}}', label: 'used', description: 'Used quota' },
    { value: '{{remaining}}', label: 'remaining', description: 'Remaining quota' },
    { value: '{{percent}}', label: '%', description: 'Usage percent' },
    { value: '{{bar}}', label: 'bar', description: 'Progress bar' },
    { value: '{{baseUrl}}', label: 'baseUrl', description: 'Base URL' },
    { value: '{{apiKey}}', label: 'apiKey', description: 'API key' },
  ],
)

const balanceScriptEnabledFieldCount = computed(
  () => balanceScriptSettings.value.enabledFields.length,
)

const balanceScriptTemplateUsedFields = computed(() => {
  const template = balanceScriptSettings.value.extraTemplate
  if (!template) return new Set<BalanceScriptFieldKey>()
  const used = new Set<BalanceScriptFieldKey>()
  for (const field of BALANCE_SCRIPT_FIELDS) {
    if (template.includes(`{{${field}}}`)) used.add(field)
  }
  return used
})

const balanceScriptCurrentRangeLabel = computed(() => {
  const currentMode = balanceScriptTimeRangeModeOptions.value.find(
    (opt) => opt.value === balanceScriptSettings.value.timeRangeMode,
  )
  if (!currentMode) return 'Unknown'
  if (balanceScriptSettings.value.timeRangeMode === 'customWindow') {
    return `Last ${balanceScriptSettings.value.windowHours}h`
  }
  if (balanceScriptSettings.value.timeRangeMode === 'dailyReset') {
    const period = balanceScriptResetPeriodOptions.value.find(
      (opt) => opt.value === balanceScriptSettings.value.resetPeriod,
    )
    return `Every ${balanceScriptSettings.value.resetEvery} ${period?.label || ''}`
  }
  return currentMode.label
})

const balanceScriptPreview = computed(() => {
  if (!props.token) return ''
  return buildCcswitchBalanceScript(
    getUsageEndpointUrl(),
    props.token.token,
    balanceScriptSettings.value,
  )
})

// ---- functions ----
const getUsageEndpointUrl = () => {
  const mode = balanceScriptSettings.value.hardcodedUsageEndpointSource
  if (mode === 'ai')
    return buildRelayAiUsageEndpointUrl({
      relayPublicBaseUrl: import.meta.env.VITE_RELAY_PUBLIC_BASE_URL,
      aiProxyUrl: import.meta.env.VITE_AI_PROXY_URL,
    })
  if (mode === 'api') return buildRelayApiUsageEndpointUrl(import.meta.env.VITE_BACKEND_URL)
  return buildRelayUsageEndpointUrl({
    relayPublicBaseUrl: import.meta.env.VITE_RELAY_PUBLIC_BASE_URL,
    aiProxyUrl: import.meta.env.VITE_AI_PROXY_URL,
    backendBaseUrl: import.meta.env.VITE_BACKEND_URL,
  })
}

const handleBalanceScriptTemplatePresetChange = (preset: BalanceScriptTemplatePreset) => {
  balanceScriptSettings.value.templatePreset = preset
  if (preset !== 'custom') {
    balanceScriptSettings.value.extraTemplate = BALANCE_SCRIPT_TEMPLATE_PRESETS[preset]
  }
}

const handleBalanceScriptTemplateInput = () => {
  balanceScriptSettings.value.templatePreset = 'custom'
}

const updateBalanceScriptFieldFormat = (
  field: BalanceScriptFieldKey,
  format: BalanceScriptMetricFormat,
) => {
  balanceScriptSettings.value.fieldFormats = {
    ...balanceScriptSettings.value.fieldFormats,
    [field]: format,
  }
}

const updateBalanceScriptFieldDecimals = (field: BalanceScriptFieldKey, decimals: number) => {
  balanceScriptSettings.value.fieldDecimals = {
    ...balanceScriptSettings.value.fieldDecimals,
    [field]: Math.min(Math.max(Number(decimals), 0), 4),
  }
}

const balanceScriptFieldTableRowClass = ({ row }: { row: BalanceScriptFieldOption }) => {
  return balanceScriptTemplateUsedFields.value.has(row.value)
    ? 'balance-script-field-table__row--used'
    : ''
}

const asBalanceScriptField = (v: any): BalanceScriptFieldOption => v

const getFieldFormatValue = (field: any): BalanceScriptMetricFormat => {
  const f = asBalanceScriptField(field)
  return balanceScriptSettings.value.fieldFormats[f.value] || 'exact'
}

const getFieldDecimalsValue = (field: any): number => {
  const f = asBalanceScriptField(field)
  return (
    balanceScriptSettings.value.fieldDecimals?.[f.value] ??
    balanceScriptSettings.value.decimalPlaces
  )
}

const insertBalanceScriptTemplatePlaceholder = async (placeholder: string) => {
  const textarea = balanceScriptTemplateInputRef.value?.textarea
  if (!textarea) {
    balanceScriptSettings.value.extraTemplate += placeholder
    await nextTick()
    balanceScriptTemplateInputRef.value?.focus?.()
    return
  }

  const cursorPosition = textarea.selectionStart ?? balanceScriptSettings.value.extraTemplate.length
  const currentText = balanceScriptSettings.value.extraTemplate
  balanceScriptSettings.value.extraTemplate =
    currentText.slice(0, cursorPosition) +
    placeholder +
    currentText.slice(textarea.selectionEnd ?? cursorPosition)

  await nextTick()
  balanceScriptTemplateInputRef.value?.focus?.()
  balanceScriptTemplateInputRef.value?.textarea?.setSelectionRange(
    cursorPosition + placeholder.length,
    cursorPosition + placeholder.length,
  )
}

const resetBalanceScriptSettings = () => {
  balanceScriptSettings.value = cloneDefaultBalanceScriptSettings()
}

const copyConfiguredBalanceScript = async () => {
  if (!props.token) return

  const script = balanceScriptPreview.value

  try {
    await copyTextWithFallback(script)
    TypedLocalStorage.set(BALANCE_SCRIPT_STORAGE_KEY, balanceScriptSettings.value)
    ElMessage.success(i18ns.t('relay.exportToCcswitchSuccess'))
  } catch {
    ElMessage.error(i18ns.t('relay.exportToCcswitchFailed'))
  }
}

// watch: persist settings on change (debounced)
watch(
  balanceScriptSettings,
  (val) => {
    TypedLocalStorage.set(BALANCE_SCRIPT_STORAGE_KEY, val)
  },
  { deep: true },
)
</script>

<style scoped lang="scss">
.balance-script-dialog__body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 0 4px;
}

.balance-script-dialog__token {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.balance-script-dialog__token-main {
  display: flex;
  align-items: center;
  gap: 8px;
}

.balance-script-dialog__token-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
}

.balance-script-dialog__token-name {
  font-weight: 600;
  font-size: 14px;
  word-break: break-all;
}

.balance-script-dialog__token-tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.balance-script-dialog__v1-link {
  margin-bottom: 8px;
}

.balance-script-dialog__v1-link-text {
  font-size: 13px;
}

.balance-script-dialog__v1-link-icon {
  margin-left: 4px;
  font-size: 13px;
}

.deprecated-tag {
  margin-left: 4px;
  vertical-align: middle;
  font-size: 10px;
}

.balance-script-workbench {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.balance-script-workbench__main {
  display: flex;
  gap: 16px;
  align-items: stretch;
}

.balance-script-workbench__main .balance-script-config {
  flex: 5;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-self: stretch;
}

.balance-script-workbench__main .balance-script-field-panel {
  flex: 4;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-self: stretch;
}

.balance-script-config .balance-script-panel--main {
  flex: 1;
  width: 100%;
}

.balance-script-config :deep(.el-card__body) {
  padding: 16px;
}

.balance-script-panel__content--main {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.balance-script-config-sections {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.balance-script-config-row--display {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}

@media (max-width: 900px) {
  .balance-script-config-row--display {
    grid-template-columns: repeat(2, 1fr);
  }
}

.balance-script-config-cell {
  margin-bottom: 0;
}

.balance-script-template-field {
  margin-bottom: 0;
}

.balance-script-template-field :deep(.el-form-item__content) {
  flex-direction: column;
  align-items: stretch;
}

.balance-script-template-placeholders {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
  margin-top: 6px;
}

.balance-script-template-placeholders__label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-right: 4px;
}

.balance-script-template-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.4;
  margin-top: 4px;
}

.balance-script-range-row {
  margin-top: 4px;
}

.balance-script-range-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.balance-script-range-panel__mode {
  margin-bottom: 0;
}

.balance-script-range-group {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.balance-script-range-panel__detail {
  padding: 12px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.balance-script-inline-fields {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  flex-wrap: wrap;
}

.balance-script-inline-fields :deep(.el-form-item) {
  flex: 1;
  min-width: 160px;
  margin-bottom: 0;
}

.balance-script-inline-fields--double :deep(.el-form-item) {
  flex: 1;
  min-width: 120px;
}

.balance-script-reset-fields {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
}

.balance-script-field-panel :deep(.el-card__body) {
  padding: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.balance-script-field-table {
  flex: 1;
  width: 100%;
  overflow: hidden;
  min-height: 0;
}

.balance-script-field-table__el-table {
  height: 100%;
}

.balance-script-field-table__el-table :deep(.el-table__row--used) {
  background: rgba(64, 158, 255, 0.04);
}

.balance-script-field-table__short-text {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Consolas', monospace;
}

.balance-script-field-row__badge {
  font-size: 10px;
  height: auto;
  line-height: 1.4;
  padding: 0 4px;
  margin-right: 2px;
  flex-shrink: 0;
}

.balance-script-field-row__help {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  cursor: help;
  margin-left: 2px;
  flex-shrink: 0;
}

.balance-script-field-row__format {
  width: 100%;
}

.balance-script-field-row__decimals {
  width: 100%;
}

.balance-script-preview-panel :deep(.el-card__body) {
  padding: 16px;
}

.balance-script-preview-panel__content {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.balance-script-preview-panel__meta {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.balance-script-preview-panel :deep(.el-textarea__inner) {
  font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Consolas', monospace;
  font-size: 12px;
  line-height: 1.5;
}

.balance-script-dialog__footer {
  display: flex;
  justify-content: center;
}

.balance-script-dialog__footer-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

/* mobile */
@media (max-width: 768px) {
  .balance-script-workbench,
  .balance-script-workbench__main,
  .balance-script-config-sections,
  .balance-script-config-row--display,
  .balance-script-range-row,
  .balance-script-inline-fields--double,
  .balance-script-dialog__footer {
    flex-direction: column;
  }

  .balance-script-workbench__main .balance-script-field-panel {
    max-height: 400px;
  }

  .balance-script-config-row--display .balance-script-config-cell {
    grid-column: 1 / -1;
  }

  .balance-script-config-row--display :deep(.el-form-item__label) {
    padding-bottom: 0;
  }

  .balance-script-inline-fields,
  .balance-script-inline-fields--double {
    flex-direction: column;
    gap: 8px;
  }

  .balance-script-field-row {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }

  .balance-script-preview-panel__actions,
  .balance-script-dialog__footer-actions {
    flex-wrap: wrap;
  }

  .balance-script-dialog__token-tags {
    margin-left: 0;
  }
}
</style>
