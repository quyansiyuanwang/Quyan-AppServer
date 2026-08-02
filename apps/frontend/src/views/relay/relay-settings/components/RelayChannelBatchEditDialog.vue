<template>
  <el-dialog
    v-model="showChannelBatchEditDialog"
    :title="dialogTitle"
    :width="isDesktop ? '860px' : 'calc(100% - 24px)'"
    destroy-on-close
  >
    <p class="text-sm text-[#606266] mb-4">
      {{ dialogDescription }}
    </p>

    <el-alert
      v-if="!isMigrationMode"
      :title="i18ns.t('relay.batchEditSafeFieldsHelp')"
      type="info"
      :closable="false"
      class="mb-4"
    />

    <el-form label-width="170px" label-position="left" class="relay-channel-batch-editor">
      <template v-if="!isMigrationMode">
        <el-divider content-position="left">{{ i18ns.t('relay.batchEditBasic') }}</el-divider>
        <el-form-item>
          <template #label
            ><el-checkbox v-model="enabled.multiplier">{{
              i18ns.t('relay.channelMultiplier')
            }}</el-checkbox></template
          >
          <template v-if="enabled.multiplier">
            <el-input-number
              v-model="form.multiplier"
              :min="0"
              :max="1000"
              :step="0.000001"
              :precision="6"
            />
          </template>
        </el-form-item>
        <el-form-item>
          <template #label
            ><el-checkbox v-model="enabled.formats">{{
              i18ns.t('relay.allowedFormats')
            }}</el-checkbox></template
          >
          <template v-if="enabled.formats">
            <el-checkbox-group v-model="form.allowedFormats">
              <el-checkbox value="openai">OpenAI</el-checkbox>
              <el-checkbox value="anthropic">Anthropic</el-checkbox>
              <el-checkbox value="gemini">Gemini</el-checkbox>
            </el-checkbox-group>
          </template>
        </el-form-item>
        <el-form-item>
          <template #label
            ><el-checkbox v-model="enabled.userIdentifier">{{
              i18ns.t('relay.batchEditUserIdentifier')
            }}</el-checkbox></template
          >
          <template v-if="enabled.userIdentifier">
            <el-switch v-model="form.addUserIdentifier" />
          </template>
        </el-form-item>
        <el-form-item>
          <template #label
            ><el-checkbox v-model="enabled.cacheRead">{{
              i18ns.t('relay.inputTokensIncludeCacheRead')
            }}</el-checkbox></template
          >
          <template v-if="enabled.cacheRead">
            <el-switch v-model="form.inputTokensIncludeCacheRead" />
          </template>
        </el-form-item>

        <el-divider content-position="left">
          <el-checkbox v-model="enabled.allowedModels">{{
            i18ns.t('relay.allowedModels')
          }}</el-checkbox>
        </el-divider>
        <template v-if="enabled.allowedModels">
          <el-form-item :label="i18ns.t('relay.batchEditRestrictModels')">
            <el-switch v-model="form.restrictModels" />
          </el-form-item>
          <el-form-item v-if="form.restrictModels" :label="i18ns.t('relay.allowedModels')">
            <el-select v-model="form.allowedModels" multiple filterable style="width: 100%">
              <el-option
                v-for="model in modelRates"
                :key="model.model"
                :label="formatModel(model)"
                :value="model.model"
              />
            </el-select>
          </el-form-item>
        </template>

        <el-divider content-position="left">
          <el-checkbox v-model="enabled.modelMapping">{{
            i18ns.t('relay.modelMapping')
          }}</el-checkbox>
        </el-divider>
        <el-form-item v-if="enabled.modelMapping" :label="i18ns.t('relay.modelMapping')">
          <el-input
            v-model="form.modelMappingJson"
            type="textarea"
            :rows="4"
            :placeholder="'{\n  &quot;gpt-5.6-luna&quot;: &quot;gpt-5.6-luna-disc-1&quot;\n}'"
          />
        </el-form-item>

        <el-divider content-position="left">
          <el-checkbox v-model="enabled.visibility">{{
            i18ns.t('relay.visibilityMode')
          }}</el-checkbox>
        </el-divider>
        <template v-if="enabled.visibility">
          <el-form-item :label="i18ns.t('relay.visibilityMode')">
            <el-select v-model="form.visibilityMode" style="width: 100%">
              <el-option value="public" :label="i18ns.t('relay.visibilityModePublic')" />
              <el-option value="private" :label="i18ns.t('relay.visibilityModePrivate')" />
              <el-option value="whitelist" :label="i18ns.t('relay.visibilityModeWhitelist')" />
              <el-option value="hidden" :label="i18ns.t('relay.visibilityModeHidden')" />
            </el-select>
          </el-form-item>
          <el-form-item :label="i18ns.t('relay.batchEditVisibilityConfig')">
            <el-input
              v-model="form.visibilityConfigJson"
              type="textarea"
              :rows="3"
              :placeholder="'{ &quot;userIds&quot;: [], &quot;groupIds&quot;: [], &quot;roleIds&quot;: [] }'"
            />
          </el-form-item>
        </template>

        <el-divider content-position="left">
          <el-checkbox v-model="enabled.routing">{{ i18ns.t('relay.routingConfig') }}</el-checkbox>
        </el-divider>
        <template v-if="enabled.routing">
          <el-form-item :label="i18ns.t('relay.routingStrategy')">
            <el-select v-model="form.routingStrategy" style="width: 100%">
              <el-option
                v-for="strategy in routingStrategies"
                :key="strategy"
                :label="strategy"
                :value="strategy"
              />
            </el-select>
          </el-form-item>
          <el-form-item :label="i18ns.t('relay.routingConfig')">
            <el-input v-model="form.routingConfigJson" type="textarea" :rows="5" placeholder="{}" />
          </el-form-item>
        </template>

        <el-divider content-position="left">
          <el-checkbox v-model="enabled.timeRules">{{ i18ns.t('relay.timeRules') }}</el-checkbox>
        </el-divider>
        <el-form-item v-if="enabled.timeRules" :label="i18ns.t('relay.timeRules')">
          <el-input v-model="form.timeRulesJson" type="textarea" :rows="4" placeholder="[]" />
        </el-form-item>

        <el-divider content-position="left">
          <el-checkbox v-model="enabled.contextRules">{{
            i18ns.t('relay.contextRules')
          }}</el-checkbox>
        </el-divider>
        <el-form-item v-if="enabled.contextRules" :label="i18ns.t('relay.contextRules')">
          <el-input v-model="form.contextRulesJson" type="textarea" :rows="4" placeholder="[]" />
        </el-form-item>
      </template>

      <template v-if="isMigrationMode">
        <el-divider content-position="left">{{
          i18ns.t('relay.modelPricingMigration')
        }}</el-divider>
        <el-alert
          :title="i18ns.t('relay.modelPricingMigrationHelp')"
          type="warning"
          :closable="false"
          class="mb-3"
        />
        <el-form-item :label="i18ns.t('relay.modelPricingMigrationSource')">
          <el-input v-model="form.sourceModelId" placeholder="gpt-5.6-luna" />
        </el-form-item>
        <el-form-item :label="i18ns.t('relay.modelPricingMigrationTarget')">
          <el-select v-model="form.targetPricingModel" filterable style="width: 100%">
            <el-option
              v-for="model in modelRates"
              :key="model.model"
              :label="formatModel(model)"
              :value="model.model"
            />
          </el-select>
        </el-form-item>
        <el-form-item :label="i18ns.t('relay.modelPricingMigrationUpstream')">
          <el-text>{{ selectedTargetModel?.modelId || '—' }}</el-text>
        </el-form-item>
      </template>
    </el-form>

    <template #footer>
      <el-button @click="showChannelBatchEditDialog = false">{{ i18ns.t('cancel') }}</el-button>
      <el-button type="primary" :loading="saving" :disabled="!hasPatch" @click="submit">
        {{
          isMigrationMode
            ? i18ns.t('relay.applyModelPricingMigration')
            : i18ns.t('relay.applyBatchEdit')
        }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type {
  BatchUpdateRelayChannelPatch,
  RelayChannelRoutingStrategy,
  RelayChannelVisibilityConfigDto,
} from '@/client/types.gen'
import { i18ns } from '@/locales'
import { useRelaySettingsManagementContext } from '../context'

const {
  isDesktop,
  selectedChannelCount,
  showChannelBatchEditDialog,
  channelBatchEditMode,
  modelRates,
  handleBatchUpdateChannels,
} = useRelaySettingsManagementContext()

const enabled = reactive({
  multiplier: false,
  formats: false,
  userIdentifier: false,
  cacheRead: false,
  allowedModels: false,
  modelMapping: false,
  visibility: false,
  routing: false,
  timeRules: false,
  contextRules: false,
})
const form = reactive({
  multiplier: 1,
  allowedFormats: ['openai'] as string[],
  restrictModels: false,
  allowedModels: [] as string[],
  addUserIdentifier: true,
  inputTokensIncludeCacheRead: false,
  modelMappingJson: '{}',
  visibilityMode: 'public' as 'public' | 'private' | 'whitelist' | 'hidden',
  visibilityConfigJson: '{ "userIds": [], "groupIds": [], "roleIds": [] }',
  routingStrategy: 'priority' as RelayChannelRoutingStrategy,
  routingConfigJson: '{}',
  timeRulesJson: '[]',
  contextRulesJson: '[]',
  sourceModelId: '',
  targetPricingModel: '',
})
const saving = ref(false)
const routingStrategies: RelayChannelRoutingStrategy[] = [
  'priority',
  'random',
  'weighted-random',
  'round-robin',
  'health-priority',
  'latency-priority',
]
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

const parseJson = <T,>(value: string, field: string): T => {
  try {
    return JSON.parse(value) as T
  } catch {
    throw new Error(i18ns.t('relay.batchEditInvalidJson', { field }))
  }
}

const submit = async () => {
  try {
    const patch: BatchUpdateRelayChannelPatch = {}
    if (enabled.multiplier) patch.multiplier = form.multiplier
    if (enabled.formats)
      patch.allowedFormats =
        form.allowedFormats.length === 3 ? 'all' : form.allowedFormats.join(',')
    if (enabled.userIdentifier) patch.addUserIdentifier = form.addUserIdentifier
    if (enabled.cacheRead) patch.inputTokensIncludeCacheRead = form.inputTokensIncludeCacheRead
    if (enabled.allowedModels)
      patch.allowedModels = form.restrictModels ? JSON.stringify(form.allowedModels) : null
    if (enabled.modelMapping)
      patch.modelMapping = parseJson<Record<string, string>>(
        form.modelMappingJson,
        i18ns.t('relay.modelMapping'),
      )
    if (enabled.visibility) {
      patch.visibilityMode = form.visibilityMode
      patch.visibilityConfig = parseJson<RelayChannelVisibilityConfigDto>(
        form.visibilityConfigJson,
        i18ns.t('relay.batchEditVisibilityConfig'),
      )
    }
    if (enabled.routing) {
      patch.routingStrategy = form.routingStrategy
      patch.routingConfig = parseJson(form.routingConfigJson, i18ns.t('relay.routingConfig'))
    }
    if (enabled.timeRules)
      patch.timePeriodMultipliers = parseJson(form.timeRulesJson, i18ns.t('relay.timeRules'))
    if (enabled.contextRules)
      patch.contextLengthMultipliers = parseJson(
        form.contextRulesJson,
        i18ns.t('relay.contextRules'),
      )

    const modelPricingMigration = isMigrationMode.value
      ? {
          sourceModelId: form.sourceModelId.trim(),
          targetPricingModel: form.targetPricingModel.trim(),
        }
      : undefined
    if (
      isMigrationMode.value &&
      (!modelPricingMigration?.sourceModelId || !modelPricingMigration.targetPricingModel)
    ) {
      throw new Error(i18ns.t('relay.modelPricingMigrationRequired'))
    }

    saving.value = true
    const result = await handleBatchUpdateChannels({ patch, modelPricingMigration })
    if (result.updated.length) ElMessage.success(i18ns.t('relay.channelBatchUpdateSuccess'))
    if (result.rejected.length) {
      await ElMessageBox.alert(
        result.rejected.map((item) => `${item.id}: ${item.reason}`).join('\n'),
        i18ns.t('relay.batchEditRejected', { count: result.rejected.length }),
        { type: 'warning' },
      )
    }
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
})
</script>
