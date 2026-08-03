<template>
  <el-dialog
    v-model="showChannelBatchEditDialog"
    :title="dialogTitle"
    :width="isDesktop ? 'min(980px, calc(100vw - 64px))' : 'calc(100% - 24px)'"
    destroy-on-close
  >
    <p class="batch-editor__intro">{{ dialogDescription }}</p>

    <template v-if="!isMigrationMode">
      <el-alert :title="i18ns.t('relay.batchEditSafeFieldsHelp')" type="info" :closable="false" />
      <el-tabs v-model="activeSection" class="batch-editor__tabs">
        <el-tab-pane :label="i18ns.t('relay.batchEditBasicsTab')" name="basics">
          <el-form label-position="top" class="batch-editor__form">
            <div class="batch-editor__grid">
              <el-form-item>
                <template #label
                  ><el-checkbox v-model="enabled.multiplier">{{
                    i18ns.t('relay.channelMultiplier')
                  }}</el-checkbox></template
                >
                <el-input-number
                  v-model="form.multiplier"
                  :disabled="!enabled.multiplier"
                  :min="0"
                  :max="1000"
                  :step="0.000001"
                  :precision="6"
                />
              </el-form-item>
              <el-form-item>
                <template #label
                  ><el-checkbox v-model="enabled.formats">{{
                    i18ns.t('relay.allowedFormats')
                  }}</el-checkbox></template
                >
                <el-checkbox-group v-model="form.allowedFormats" :disabled="!enabled.formats">
                  <el-checkbox value="openai">OpenAI</el-checkbox>
                  <el-checkbox value="anthropic">Anthropic</el-checkbox>
                  <el-checkbox value="gemini">Gemini</el-checkbox>
                </el-checkbox-group>
              </el-form-item>
              <el-form-item>
                <template #label
                  ><el-checkbox v-model="enabled.userIdentifier">{{
                    i18ns.t('relay.batchEditUserIdentifier')
                  }}</el-checkbox></template
                >
                <el-switch v-model="form.addUserIdentifier" :disabled="!enabled.userIdentifier" />
              </el-form-item>
              <el-form-item>
                <template #label
                  ><el-checkbox v-model="enabled.cacheRead">{{
                    i18ns.t('relay.inputTokensIncludeCacheRead')
                  }}</el-checkbox></template
                >
                <el-switch
                  v-model="form.inputTokensIncludeCacheRead"
                  :disabled="!enabled.cacheRead"
                />
              </el-form-item>
            </div>
          </el-form>
        </el-tab-pane>

        <el-tab-pane :label="i18ns.t('relay.batchEditModelsTab')" name="models">
          <el-form label-position="top" class="batch-editor__form">
            <section class="batch-editor__section">
              <el-checkbox v-model="enabled.allowedModels">{{
                i18ns.t('relay.allowedModels')
              }}</el-checkbox>
              <div class="batch-editor__section-body">
                <el-switch
                  v-model="form.restrictModels"
                  :disabled="!enabled.allowedModels"
                  :active-text="i18ns.t('relay.restrictModels')"
                  :inactive-text="i18ns.t('relay.allowAllModels')"
                />
                <el-select
                  v-if="form.restrictModels"
                  v-model="form.allowedModels"
                  :disabled="!enabled.allowedModels"
                  multiple
                  filterable
                  style="width: 100%; margin-top: 12px"
                >
                  <el-option
                    v-for="model in modelRates"
                    :key="model.model"
                    :label="formatModel(model)"
                    :value="model.model"
                  />
                </el-select>
              </div>
            </section>
            <section class="batch-editor__section">
              <el-checkbox v-model="enabled.modelMapping">{{
                i18ns.t('relay.modelMapping')
              }}</el-checkbox>
              <div class="batch-editor__section-body">
                <ModelMappingEditor
                  v-model="form.modelMapping"
                  :available-models="modelRates.map((model) => model.model)"
                  :disabled="!enabled.modelMapping"
                />
              </div>
            </section>
          </el-form>
        </el-tab-pane>

        <el-tab-pane :label="i18ns.t('relay.batchEditAccessRoutingTab')" name="access-routing">
          <el-form label-position="top" class="batch-editor__form">
            <section class="batch-editor__section">
              <el-checkbox v-model="enabled.visibility">{{
                i18ns.t('relay.visibilityMode')
              }}</el-checkbox>
              <div class="batch-editor__section-body">
                <el-select
                  v-model="form.visibilityMode"
                  :disabled="!enabled.visibility"
                  style="width: 100%"
                >
                  <el-option value="public" :label="i18ns.t('relay.visibilityModePublic')" />
                  <el-option value="private" :label="i18ns.t('relay.visibilityModePrivate')" />
                  <el-option value="whitelist" :label="i18ns.t('relay.visibilityModeWhitelist')" />
                  <el-option value="hidden" :label="i18ns.t('relay.visibilityModeHidden')" />
                </el-select>
                <div
                  v-if="form.visibilityMode === 'whitelist'"
                  class="batch-editor__grid batch-editor__grid--spaced"
                >
                  <el-form-item :label="i18ns.t('relay.visibilityUsers')">
                    <el-select
                      v-model="form.visibilityConfig.userIds"
                      :disabled="!enabled.visibility"
                      multiple
                      filterable
                      remote
                      allow-create
                      default-first-option
                      :remote-method="handleVisibilityUserSearch"
                      :loading="visibilityUserOptionsLoading"
                      style="width: 100%"
                    >
                      <el-option
                        v-for="user in visibilityUserOptions"
                        :key="user.id"
                        :label="user.name ? `${user.name} (${user.username})` : user.username"
                        :value="user.id"
                      />
                    </el-select>
                  </el-form-item>
                  <el-form-item :label="i18ns.t('relay.visibilityGroups')">
                    <el-select
                      v-model="form.visibilityConfig.groupIds"
                      :disabled="!enabled.visibility"
                      multiple
                      filterable
                      allow-create
                      default-first-option
                      :loading="visibilityGroupOptionsLoading"
                      style="width: 100%"
                    >
                      <el-option
                        v-for="group in visibilityGroupOptions"
                        :key="group.id"
                        :label="group.name"
                        :value="group.id"
                      />
                    </el-select>
                  </el-form-item>
                  <el-form-item :label="i18ns.t('relay.visibilityRoles')">
                    <el-select
                      v-model="form.visibilityConfig.roleIds"
                      :disabled="!enabled.visibility"
                      multiple
                      filterable
                      allow-create
                      default-first-option
                      :loading="visibilityRoleOptionsLoading"
                      style="width: 100%"
                    >
                      <el-option
                        v-for="role in visibilityRoleOptions"
                        :key="role.id"
                        :label="role.name"
                        :value="role.id"
                      />
                    </el-select>
                  </el-form-item>
                </div>
              </div>
            </section>
            <section class="batch-editor__section">
              <el-checkbox v-model="enabled.routing">{{
                i18ns.t('relay.routingConfig')
              }}</el-checkbox>
              <div class="batch-editor__section-body batch-editor__grid">
                <el-form-item :label="i18ns.t('relay.routingStrategy')">
                  <el-select
                    v-model="form.routingStrategy"
                    :disabled="!enabled.routing"
                    style="width: 100%"
                  >
                    <el-option
                      v-for="strategy in routingStrategies"
                      :key="strategy.value"
                      :label="strategy.label"
                      :value="strategy.value"
                    />
                  </el-select>
                </el-form-item>
                <el-form-item :label="i18ns.t('relay.maxRetries')"
                  ><el-input-number
                    v-model="form.routingConfig.maxRetries"
                    :disabled="!enabled.routing"
                    :min="0"
                    :max="100"
                /></el-form-item>
                <el-form-item :label="i18ns.t('relay.failoverThreshold')"
                  ><el-input-number
                    v-model="form.routingConfig.failoverThreshold"
                    :disabled="!enabled.routing"
                    :min="0"
                    :max="100"
                /></el-form-item>
                <el-form-item :label="i18ns.t('relay.failbackCooldownMinutes')"
                  ><el-input-number
                    v-model="form.routingConfig.failbackCooldownMinutes"
                    :disabled="!enabled.routing"
                    :min="0"
                    :max="10080"
                /></el-form-item>
                <el-form-item :label="i18ns.t('relay.retryStatusCodes')">
                  <el-select
                    v-model="form.routingConfig.retryStatusCodes"
                    :disabled="!enabled.routing"
                    multiple
                    style="width: 100%"
                    ><el-option value="4xx" label="4xx" /><el-option
                      value="5xx"
                      label="5xx" /><el-option value="401" label="401" /><el-option
                      value="429"
                      label="429"
                  /></el-select>
                </el-form-item>
                <el-form-item :label="i18ns.t('relay.stickyByModel')"
                  ><el-switch
                    v-model="form.routingConfig.stickyByModel"
                    :disabled="!enabled.routing"
                /></el-form-item>
                <el-form-item :label="i18ns.t('relay.stickyByFormat')"
                  ><el-switch
                    v-model="form.routingConfig.stickyByFormat"
                    :disabled="!enabled.routing"
                /></el-form-item>
              </div>
              <el-collapse v-model="routingAdvancedSections" class="batch-editor__advanced">
                <el-collapse-item
                  :title="i18ns.t('relay.batchEditAdvancedRouting')"
                  name="thresholds"
                >
                  <p class="batch-editor__hint">
                    {{ i18ns.t('relay.routingConfigOptionalThresholdsHelp') }}
                  </p>
                  <div class="batch-editor__grid">
                    <el-form-item :label="i18ns.t('relay.healthScoreThreshold')">
                      <el-input-number
                        v-model="form.routingConfig.healthScoreThreshold"
                        :disabled="!enabled.routing"
                        :min="0"
                        :max="1"
                        :step="0.01"
                        :precision="2"
                        clearable
                      />
                    </el-form-item>
                    <el-form-item :label="i18ns.t('relay.latencyThresholdMs')">
                      <el-input-number
                        v-model="form.routingConfig.latencyThresholdMs"
                        :disabled="!enabled.routing"
                        :min="0"
                        :max="600000"
                        :step="10"
                        clearable
                      />
                    </el-form-item>
                    <el-form-item :label="i18ns.t('relay.circuitBreakerThreshold')">
                      <el-input-number
                        v-model="form.routingConfig.circuitBreakerThreshold"
                        :disabled="!enabled.routing"
                        :min="0"
                        :max="1000"
                        clearable
                      />
                    </el-form-item>
                  </div>
                </el-collapse-item>
                <el-collapse-item name="health">
                  <template #title
                    ><el-checkbox v-model="enabled.routingHealth" @click.stop>{{
                      i18ns.t('relay.healthTrackingMode')
                    }}</el-checkbox></template
                  >
                  <el-radio-group
                    v-model="form.routingConfig.healthTrackingMode"
                    :disabled="!enabled.routingHealth"
                  >
                    <el-radio value="automatic">{{
                      i18ns.t('relay.healthTrackingAutomatic')
                    }}</el-radio>
                    <el-radio value="manual">{{ i18ns.t('relay.healthTrackingManual') }}</el-radio>
                    <el-radio value="disabled">{{
                      i18ns.t('relay.healthTrackingDisabled')
                    }}</el-radio>
                  </el-radio-group>
                  <div
                    v-if="form.routingConfig.healthTrackingMode === 'manual'"
                    class="batch-editor__grid batch-editor__grid--spaced"
                  >
                    <el-form-item :label="i18ns.t('relay.healthManualAvailability')">
                      <el-input-number
                        v-model="form.routingConfig.manualAvailability"
                        :disabled="!enabled.routingHealth"
                        :min="0"
                        :max="1"
                        :step="0.01"
                        :precision="2"
                      />
                    </el-form-item>
                    <el-form-item :label="i18ns.t('relay.healthManualLatency')">
                      <el-input-number
                        v-model="form.routingConfig.manualLatencyMs"
                        :disabled="!enabled.routingHealth"
                        :min="0"
                        :max="600000"
                        :step="10"
                      />
                    </el-form-item>
                  </div>
                </el-collapse-item>
                <el-collapse-item name="automatic-pool">
                  <template #title
                    ><el-checkbox v-model="enabled.routingAutomaticPool" @click.stop>{{
                      i18ns.t('relay.automaticPoolDynamicRanking')
                    }}</el-checkbox></template
                  >
                  <div class="batch-editor__stack">
                    <el-switch
                      v-model="form.routingConfig.dynamicMemberRankingEnabled"
                      :disabled="!enabled.routingAutomaticPool"
                      :active-text="i18ns.t('relay.automaticPoolDynamicRanking')"
                    />
                    <el-form-item :label="i18ns.t('relay.automaticPoolRankingMode')">
                      <el-select
                        v-model="form.routingConfig.rankingMode"
                        :disabled="
                          !enabled.routingAutomaticPool ||
                          !form.routingConfig.dynamicMemberRankingEnabled
                        "
                        style="width: 100%"
                      >
                        <el-option
                          value="price-first"
                          :label="i18ns.t('relay.automaticPoolRankingPriceFirst')"
                        />
                        <el-option
                          value="stability-first"
                          :label="i18ns.t('relay.automaticPoolRankingStabilityFirst')"
                        />
                      </el-select>
                    </el-form-item>
                    <el-form-item :label="i18ns.t('relay.batchEditAllowedModelsMode')">
                      <el-select
                        v-model="form.routingConfig.allowedModelsMode"
                        :disabled="!enabled.routingAutomaticPool"
                        style="width: 100%"
                      >
                        <el-option value="all" :label="i18ns.t('relay.allowedModelsModeAll')" />
                        <el-option value="auto" :label="i18ns.t('relay.allowedModelsModeAuto')" />
                        <el-option
                          value="manual"
                          :label="i18ns.t('relay.allowedModelsModeManual')"
                        />
                      </el-select>
                    </el-form-item>
                  </div>
                </el-collapse-item>
              </el-collapse>
            </section>
          </el-form>
        </el-tab-pane>

        <el-tab-pane :label="i18ns.t('relay.batchEditMultiplierRulesTab')" name="rules">
          <el-form label-position="top" class="batch-editor__form">
            <section class="batch-editor__section">
              <div class="batch-editor__section-heading">
                <el-checkbox v-model="enabled.timeRules">{{
                  i18ns.t('relay.timeRules')
                }}</el-checkbox
                ><el-button :disabled="!enabled.timeRules" size="small" @click="addTimeRule">{{
                  i18ns.t('relay.timeRuleAdd')
                }}</el-button>
              </div>
              <div v-if="enabled.timeRules" class="batch-editor__rules">
                <div
                  v-for="(rule, index) in form.timeRules"
                  :key="rule.key"
                  class="batch-editor__rule-row"
                >
                  <el-input v-model="rule.name" :placeholder="i18ns.t('relay.timeRuleName')" />
                  <el-select
                    v-model="rule.dayOfWeek"
                    multiple
                    collapse-tags
                    :max-collapse-tags="1"
                    :placeholder="i18ns.t('relay.timeRuleDays')"
                    ><el-option
                      v-for="day in dayOptions"
                      :key="day.value"
                      :label="day.label"
                      :value="day.value"
                  /></el-select>
                  <el-time-picker
                    v-model="rule.range"
                    is-range
                    value-format="HH:mm"
                    format="HH:mm"
                    :placeholder="i18ns.t('relay.timeRuleTimeRange')"
                  />
                  <el-input-number
                    v-model="rule.multiplier"
                    :min="0.01"
                    :step="0.01"
                    :precision="6"
                  />
                  <el-switch v-model="rule.enabled" />
                  <el-button text type="danger" @click="form.timeRules.splice(index, 1)">{{
                    i18ns.t('delete')
                  }}</el-button>
                </div>
                <el-empty
                  v-if="form.timeRules.length === 0"
                  :description="i18ns.t('relay.timeRulesEmpty')"
                  :image-size="56"
                />
              </div>
            </section>
            <section class="batch-editor__section">
              <div class="batch-editor__section-heading">
                <el-checkbox v-model="enabled.contextRules">{{
                  i18ns.t('relay.contextRules')
                }}</el-checkbox
                ><el-button
                  :disabled="!enabled.contextRules"
                  size="small"
                  @click="addContextRule"
                  >{{ i18ns.t('relay.contextRuleAdd') }}</el-button
                >
              </div>
              <div v-if="enabled.contextRules" class="batch-editor__rules">
                <div
                  v-for="(rule, index) in form.contextRules"
                  :key="rule.key"
                  class="batch-editor__context-row"
                >
                  <el-input v-model="rule.name" :placeholder="i18ns.t('relay.contextRuleName')" />
                  <el-input-number v-model="rule.minTokens" :min="0" :step="1000" :precision="0" />
                  <el-input-number
                    v-model="rule.multiplier"
                    :min="0.01"
                    :step="0.01"
                    :precision="6"
                  />
                  <el-switch v-model="rule.enabled" />
                  <el-button text type="danger" @click="form.contextRules.splice(index, 1)">{{
                    i18ns.t('delete')
                  }}</el-button>
                </div>
                <el-empty
                  v-if="form.contextRules.length === 0"
                  :description="i18ns.t('relay.contextRulesEmpty')"
                  :image-size="56"
                />
              </div>
            </section>
          </el-form>
        </el-tab-pane>
      </el-tabs>
    </template>

    <el-form v-else label-position="top" class="batch-editor__form">
      <el-alert
        :title="i18ns.t('relay.modelPricingMigrationHelp')"
        type="warning"
        :closable="false"
      />
      <div class="batch-editor__migration-grid">
        <el-form-item :label="i18ns.t('relay.modelPricingMigrationSource')"
          ><el-input v-model="form.sourceModelId" placeholder="gpt-5.6-luna"
        /></el-form-item>
        <el-form-item :label="i18ns.t('relay.modelPricingMigrationTarget')"
          ><el-select v-model="form.targetPricingModel" filterable style="width: 100%"
            ><el-option
              v-for="model in modelRates"
              :key="model.model"
              :label="formatModel(model)"
              :value="model.model" /></el-select
        ></el-form-item>
      </div>
      <el-descriptions :column="1" border size="small"
        ><el-descriptions-item :label="i18ns.t('relay.modelPricingMigrationUpstream')">{{
          selectedTargetModel?.modelId || '-'
        }}</el-descriptions-item></el-descriptions
      >
    </el-form>

    <template #footer>
      <el-button @click="showChannelBatchEditDialog = false">{{ i18ns.t('cancel') }}</el-button>
      <el-button type="primary" :loading="saving" :disabled="!hasPatch" @click="submit">{{
        isMigrationMode
          ? i18ns.t('relay.applyModelPricingMigration')
          : i18ns.t('relay.applyBatchEdit')
      }}</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import ModelMappingEditor from '@/components/relay/ModelMappingEditor.vue'
import type { BatchUpdateRelayChannelPatch, RelayChannelRoutingStrategy } from '@/client/types.gen'
import { i18ns } from '@/locales'
import { useRelaySettingsManagementContext } from '../context'

type TimeRuleDraft = {
  key: number
  name: string
  dayOfWeek: string[]
  range: [string, string]
  multiplier: number
  enabled: boolean
}
type ContextRuleDraft = {
  key: number
  name: string
  minTokens: number
  multiplier: number
  enabled: boolean
}
let ruleKey = 0
const {
  isDesktop,
  selectedChannelCount,
  showChannelBatchEditDialog,
  channelBatchEditMode,
  modelRates,
  visibilityUserOptions,
  visibilityGroupOptions,
  visibilityRoleOptions,
  visibilityUserOptionsLoading,
  visibilityGroupOptionsLoading,
  visibilityRoleOptionsLoading,
  handleVisibilityUserSearch,
  ensureVisibilityOptionsLoaded,
  handleBatchUpdateChannels,
} = useRelaySettingsManagementContext()
const activeSection = ref('basics')
const routingAdvancedSections = ref<string[]>([])
const saving = ref(false)
const enabled = reactive({
  multiplier: false,
  formats: false,
  userIdentifier: false,
  cacheRead: false,
  allowedModels: false,
  modelMapping: false,
  visibility: false,
  routing: false,
  routingHealth: false,
  routingAutomaticPool: false,
  timeRules: false,
  contextRules: false,
})
const createForm = () => ({
  multiplier: 1,
  allowedFormats: ['openai'] as string[],
  restrictModels: false,
  allowedModels: [] as string[],
  addUserIdentifier: true,
  inputTokensIncludeCacheRead: false,
  modelMapping: {} as Record<string, string>,
  visibilityMode: 'public' as 'public' | 'private' | 'whitelist' | 'hidden',
  visibilityConfig: { userIds: [] as string[], groupIds: [] as string[], roleIds: [] as string[] },
  routingStrategy: 'priority' as RelayChannelRoutingStrategy,
  routingConfig: {
    maxRetries: 2,
    failoverThreshold: 0,
    failbackCooldownMinutes: 5,
    retryStatusCodes: ['4xx', '5xx'] as string[],
    healthScoreThreshold: null as number | null,
    latencyThresholdMs: null as number | null,
    circuitBreakerThreshold: null as number | null,
    stickyByModel: false,
    stickyByFormat: false,
    rankingMode: 'price-first' as 'price-first' | 'stability-first',
    allowedModelsMode: 'all' as 'all' | 'manual' | 'auto',
    dynamicMemberRankingEnabled: true,
    healthTrackingMode: 'automatic' as 'automatic' | 'manual' | 'disabled',
    manualAvailability: 1,
    manualLatencyMs: 0,
  },
  timeRules: [] as TimeRuleDraft[],
  contextRules: [] as ContextRuleDraft[],
  sourceModelId: '',
  targetPricingModel: '',
})
const form = reactive(createForm())
const routingStrategies = computed(() => [
  { value: 'priority' as const, label: i18ns.t('relay.routingStrategyPriority') },
  { value: 'random' as const, label: i18ns.t('relay.routingStrategyRandom') },
  { value: 'weighted-random' as const, label: i18ns.t('relay.routingStrategyWeightedRandom') },
  { value: 'round-robin' as const, label: i18ns.t('relay.routingStrategyRoundRobin') },
  { value: 'health-priority' as const, label: i18ns.t('relay.routingStrategyHealthPriority') },
  { value: 'latency-priority' as const, label: i18ns.t('relay.routingStrategyLatencyPriority') },
])
const dayOptions = computed(() =>
  [1, 2, 3, 4, 5, 6, 7].map((value) => ({
    value: String(value),
    label: i18ns.t(
      `relay.day${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][value - 1]}` as any,
    ),
  })),
)
const selectedTargetModel = computed(() =>
  modelRates.value.find((model) => model.model === form.targetPricingModel),
)
const isMigrationMode = computed(() => channelBatchEditMode.value === 'model-pricing-migration')
const dialogTitle = computed(() =>
  i18ns.t(isMigrationMode.value ? 'relay.batchModelPricingMigration' : 'relay.batchEditChannels'),
)
const dialogDescription = computed(() =>
  i18ns.t(
    isMigrationMode.value ? 'relay.batchPricingMigrationDescription' : 'relay.batchEditDescription',
    { count: selectedChannelCount.value },
  ),
)
const hasPatch = computed(() =>
  isMigrationMode.value
    ? Boolean(form.sourceModelId.trim() && form.targetPricingModel.trim())
    : Object.values(enabled).some(Boolean),
)
const formatModel = (model: { model: string; modelId: string }) =>
  model.model === model.modelId ? model.model : `${model.model} (${model.modelId})`
const addTimeRule = () =>
  form.timeRules.push({
    key: ++ruleKey,
    name: '',
    dayOfWeek: [],
    range: ['00:00', '23:59'],
    multiplier: 1,
    enabled: true,
  })
const addContextRule = () =>
  form.contextRules.push({ key: ++ruleKey, name: '', minTokens: 0, multiplier: 1, enabled: true })
const assertRuleNames = () => {
  if (enabled.formats && form.allowedFormats.length === 0)
    throw new Error(i18ns.t('relay.batchEditFormatsRequired'))
  if (
    enabled.visibility &&
    form.visibilityMode === 'whitelist' &&
    !form.visibilityConfig.userIds.length &&
    !form.visibilityConfig.groupIds.length &&
    !form.visibilityConfig.roleIds.length
  )
    throw new Error(i18ns.t('relay.batchEditWhitelistRequired'))
  if (
    enabled.timeRules &&
    form.timeRules.some((rule) => !rule.name.trim() || rule.range.length !== 2)
  )
    throw new Error(i18ns.t('relay.batchEditRulesInvalid'))
  if (
    enabled.contextRules &&
    (form.contextRules.some((rule) => !rule.name.trim()) ||
      new Set(form.contextRules.map((rule) => rule.minTokens)).size !== form.contextRules.length)
  )
    throw new Error(i18ns.t('relay.batchEditRulesInvalid'))
}
const submit = async () => {
  try {
    assertRuleNames()
    const patch: BatchUpdateRelayChannelPatch = {}
    if (enabled.multiplier) patch.multiplier = form.multiplier
    if (enabled.formats)
      patch.allowedFormats =
        form.allowedFormats.length === 3 ? 'all' : form.allowedFormats.join(',')
    if (enabled.userIdentifier) patch.addUserIdentifier = form.addUserIdentifier
    if (enabled.cacheRead) patch.inputTokensIncludeCacheRead = form.inputTokensIncludeCacheRead
    if (enabled.allowedModels)
      patch.allowedModels = form.restrictModels ? JSON.stringify(form.allowedModels) : null
    if (enabled.modelMapping) patch.modelMapping = { ...form.modelMapping }
    if (enabled.visibility) {
      patch.visibilityMode = form.visibilityMode
      patch.visibilityConfig =
        form.visibilityMode === 'hidden'
          ? null
          : {
              userIds: [...form.visibilityConfig.userIds],
              groupIds: [...form.visibilityConfig.groupIds],
              roleIds: [...form.visibilityConfig.roleIds],
            }
    }
    if (enabled.routing) patch.routingStrategy = form.routingStrategy
    if (enabled.routing || enabled.routingHealth || enabled.routingAutomaticPool) {
      patch.routingConfig = {
        ...(enabled.routing
          ? {
              maxRetries: form.routingConfig.maxRetries,
              failoverThreshold: form.routingConfig.failoverThreshold,
              failbackCooldownMinutes: form.routingConfig.failbackCooldownMinutes,
              retryStatusCodes: [...form.routingConfig.retryStatusCodes],
              healthScoreThreshold: form.routingConfig.healthScoreThreshold,
              latencyThresholdMs: form.routingConfig.latencyThresholdMs,
              circuitBreakerThreshold: form.routingConfig.circuitBreakerThreshold,
              stickyByModel: form.routingConfig.stickyByModel,
              stickyByFormat: form.routingConfig.stickyByFormat,
            }
          : {}),
        ...(enabled.routingHealth
          ? {
              healthTrackingMode: form.routingConfig.healthTrackingMode,
              manualAvailability:
                form.routingConfig.healthTrackingMode === 'manual'
                  ? form.routingConfig.manualAvailability
                  : null,
              manualLatencyMs:
                form.routingConfig.healthTrackingMode === 'manual'
                  ? form.routingConfig.manualLatencyMs
                  : null,
            }
          : {}),
        ...(enabled.routingAutomaticPool
          ? {
              allowedModelsMode: form.routingConfig.allowedModelsMode,
              rankingMode: form.routingConfig.rankingMode,
              dynamicMemberRankingEnabled: form.routingConfig.dynamicMemberRankingEnabled,
            }
          : {}),
      }
    }
    if (enabled.timeRules)
      patch.timePeriodMultipliers = form.timeRules.map((rule) => ({
        name: rule.name.trim(),
        dayOfWeek: rule.dayOfWeek.join(','),
        startTime: rule.range[0],
        endTime: rule.range[1],
        multiplier: rule.multiplier,
        enabled: rule.enabled,
      }))
    if (enabled.contextRules)
      patch.contextLengthMultipliers = form.contextRules.map((rule) => ({
        name: rule.name.trim(),
        minTokens: rule.minTokens,
        multiplier: rule.multiplier,
        enabled: rule.enabled,
      }))
    const modelPricingMigration = isMigrationMode.value
      ? {
          sourceModelId: form.sourceModelId.trim(),
          targetPricingModel: form.targetPricingModel.trim(),
        }
      : undefined
    saving.value = true
    const result = await handleBatchUpdateChannels({ patch, modelPricingMigration })
    if (result.updated.length) ElMessage.success(i18ns.t('relay.channelBatchUpdateSuccess'))
    if (result.rejected.length)
      await ElMessageBox.alert(
        result.rejected.map((item) => `${item.id}: ${item.reason}`).join('\n'),
        i18ns.t('relay.batchEditRejected', { count: result.rejected.length }),
        { type: 'warning' },
      )
    if (result.rejected.length === 0) showChannelBatchEditDialog.value = false
  } catch (error: unknown) {
    ElMessage.error(error instanceof Error ? error.message : i18ns.t('operationFailed'))
  } finally {
    saving.value = false
  }
}
watch(showChannelBatchEditDialog, (visible) => {
  if (!visible) return
  Object.keys(enabled).forEach((key) => {
    enabled[key as keyof typeof enabled] = false
  })
  Object.assign(form, createForm())
  activeSection.value = 'basics'
  routingAdvancedSections.value = []
  if (!isMigrationMode.value) void ensureVisibilityOptionsLoaded()
})
</script>

<style scoped>
.batch-editor__intro {
  margin: 0 0 16px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 1.55;
}
.batch-editor__tabs {
  margin-top: 14px;
}
.batch-editor__form {
  padding: 4px 2px;
}
.batch-editor__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 18px;
}
.batch-editor__section {
  padding: 14px 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.batch-editor__section:first-child {
  padding-top: 0;
}
.batch-editor__section-body {
  margin: 12px 0 0 26px;
}
.batch-editor__grid--spaced {
  margin-top: 12px;
}
.batch-editor__section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.batch-editor__rules {
  display: grid;
  gap: 8px;
  margin: 12px 0 0;
}
.batch-editor__rule-row,
.batch-editor__context-row {
  display: grid;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border: 1px solid var(--el-border-color-lighter);
  background: var(--el-fill-color-extra-light);
}
.batch-editor__rule-row {
  grid-template-columns: minmax(100px, 1fr) minmax(120px, 1fr) minmax(180px, 1.2fr) 104px auto auto;
}
.batch-editor__context-row {
  grid-template-columns: minmax(120px, 1fr) 150px 120px auto auto;
}
.batch-editor__migration-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 18px;
  margin-top: 18px;
}
@media (max-width: 720px) {
  .batch-editor__grid,
  .batch-editor__migration-grid,
  .batch-editor__rule-row,
  .batch-editor__context-row {
    grid-template-columns: 1fr;
  }
  .batch-editor__section-body {
    margin-left: 0;
  }
}
</style>
