<template>
  <div
    :class="[
      isDesktop ? 'desktop-page page-shell' : 'mobile-page mobile-adapter',
      'relay-provider-page',
    ]"
  >
    <el-card shadow="never" class="page-card surface-card">
      <template #header>
        <div class="page-heading">
          <div>
            <h2>{{ i18ns.t('relay.providerChannelTitle') }}</h2>
            <p>{{ i18ns.t('relay.providerChannelDescription') }}</p>
          </div>
          <el-button v-if="canSubmit" type="primary" :icon="Plus" @click="openSubmission()">{{
            i18ns.t('relay.submitChannel')
          }}</el-button>
        </div>
      </template>
      <el-table v-loading="submissionsLoading" :data="submittedChannels" size="small">
        <el-table-column prop="name" :label="i18ns.t('relay.channelName')" min-width="180" />
        <el-table-column :label="i18ns.t('relay.submissionStatus')" width="130"
          ><template #default="{ row }"
            ><el-tag :type="statusType(row.submissionStatus)">{{
              statusLabel(row.submissionStatus)
            }}</el-tag></template
          ></el-table-column
        >
        <el-table-column :label="i18ns.t('relay.providerTotalCommission')" width="150"
          ><template #default="{ row }"
            >{{ providerTotal(row.providers) }}%</template
          ></el-table-column
        >
        <el-table-column :label="i18ns.t('relay.reviewReason')" min-width="180"
          ><template #default="{ row }">{{ row.reviewReason || '-' }}</template></el-table-column
        >
        <el-table-column :label="i18ns.t('actions')" width="180" fixed="right"
          ><template #default="{ row }"
            ><el-button
              v-if="row.submissionStatus === 'approved'"
              size="small"
              :icon="Edit"
              @click="openChangeRequest(row)"
              >{{ i18ns.t('relay.submitChangeRequest') }}</el-button
            ></template
          ></el-table-column
        >
      </el-table>
      <el-pagination
        class="pagination"
        background
        layout="total, prev, pager, next"
        :current-page="submissionPage.page"
        :page-size="submissionPage.pageSize"
        :total="submissionPage.total"
        @update:current-page="loadSubmissions"
      />
    </el-card>

    <el-card v-if="canSubmit" shadow="never" class="page-card surface-card">
      <template #header
        ><div class="section-heading">
          <h3>{{ i18ns.t('relay.myChangeRequests') }}</h3>
          <el-button :icon="Refresh" text @click="loadChangeRequests()" /></div
      ></template>
      <el-table v-loading="changeRequestsLoading" :data="changeRequests" size="small">
        <el-table-column prop="channelName" :label="i18ns.t('relay.channelName')" min-width="180" />
        <el-table-column prop="reviewStatus" :label="i18ns.t('status')" width="120"
          ><template #default="{ row }"
            ><el-tag :type="changeStatusType(row.reviewStatus)">{{
              changeStatusLabel(row.reviewStatus)
            }}</el-tag></template
          ></el-table-column
        >
        <el-table-column
          prop="reviewReason"
          :label="i18ns.t('relay.reviewReason')"
          min-width="180"
        />
        <el-table-column prop="createTime" :label="i18ns.t('relay.createTime')" width="180"
          ><template #default="{ row }">{{
            formatDateTime(row.createTime)
          }}</template></el-table-column
        >
      </el-table>
      <el-pagination
        class="pagination"
        background
        layout="total, prev, pager, next"
        :current-page="changeRequestPage.page"
        :page-size="changeRequestPage.pageSize"
        :total="changeRequestPage.total"
        @update:current-page="loadChangeRequests"
      />
    </el-card>

    <el-card v-if="canReadEarnings" shadow="never" class="page-card surface-card">
      <template #header
        ><div class="page-heading">
          <div>
            <h2>{{ i18ns.t('relay.providerEarningsTitle') }}</h2>
            <p>{{ i18ns.t('relay.providerEarningsDescription') }}</p>
          </div>
          <el-button
            type="primary"
            :icon="Wallet"
            :disabled="pendingAmount <= 0"
            :loading="claiming"
            @click="claim"
            >{{ i18ns.t('relay.claimProviderEarnings') }}</el-button
          >
        </div></template
      >
      <div class="stats">
        <div>
          <span>{{ i18ns.t('relay.pendingEarnings') }}</span
          ><strong>{{ pendingAmount }}</strong>
        </div>
        <div>
          <span>{{ i18ns.t('relay.settledEarnings') }}</span
          ><strong>{{ settledAmount }}</strong>
        </div>
      </div>
      <el-table v-loading="earningsLoading" :data="earningRecords" size="small"
        ><el-table-column
          prop="channelName"
          :label="i18ns.t('relay.channelName')"
          min-width="160"
        /><el-table-column
          prop="grossAmount"
          :label="i18ns.t('relay.grossCharge')"
          width="120"
        /><el-table-column :label="i18ns.t('relay.providerCommission')" width="120"
          ><template #default="{ row }">{{ row.commissionPercent }}%</template></el-table-column
        ><el-table-column
          prop="commissionAmount"
          :label="i18ns.t('relay.earningAmount')"
          width="120"
        /><el-table-column :label="i18ns.t('status')" width="110"
          ><template #default="{ row }"
            ><el-tag :type="row.settled ? 'success' : 'warning'">{{
              row.settled ? i18ns.t('relay.settled') : i18ns.t('relay.pending')
            }}</el-tag></template
          ></el-table-column
        ><el-table-column prop="createTime" :label="i18ns.t('relay.createTime')" width="180"
          ><template #default="{ row }">{{
            formatDateTime(row.createTime)
          }}</template></el-table-column
        ></el-table
      >
      <el-pagination
        class="pagination"
        background
        layout="total, prev, pager, next"
        :current-page="earningsPage.page"
        :page-size="earningsPage.pageSize"
        :total="earningsPage.total"
        @update:current-page="loadEarnings"
      />
    </el-card>

    <el-dialog
      v-model="formVisible"
      :title="
        formMode === 'submit'
          ? i18ns.t('relay.submitChannel')
          : i18ns.t('relay.submitChangeRequest')
      "
      width="min(900px, 96vw)"
      class="relay-provider-dialog"
    >
      <el-alert
        v-if="formMode === 'change'"
        type="info"
        :closable="false"
        :title="i18ns.t('relay.changeRequestReviewOnly')"
        class="mb-4"
      />
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
                      formMode === 'change'
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
                    @click="probeModels(format)"
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
                    @click="addProbeModels(format)"
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
          <el-collapse-item name="providers" :title="i18ns.t('relay.providers')"
            ><el-alert
              type="warning"
              :closable="false"
              :title="i18ns.t('relay.providerCommissionWarning')"
              class="mb-3"
            />
            <div class="provider-summary">
              <el-tag :type="providerTotal(form.providers) > 100 ? 'warning' : 'info'"
                >{{ providerTotal(form.providers).toFixed(2) }}%</el-tag
              ><span
                >{{ i18ns.t('relay.providerPlatformRemainder') }}:
                {{ (100 - providerTotal(form.providers)).toFixed(2) }}%</span
              >
            </div>
            <div v-for="(provider, index) in form.providers" :key="index" class="provider-row">
              <el-input
                v-model="provider.userId"
                :placeholder="i18ns.t('relay.providerUserIdPlaceholder')"
              /><el-input-number
                v-model="provider.commissionPercent"
                :min="0"
                :max="100"
                :precision="4"
                :step="1"
              /><el-select v-model="provider.settlementMode"
                ><el-option
                  value="realtime"
                  :label="i18ns.t('relay.settlementModeRealtime')" /><el-option
                  value="interval"
                  :label="i18ns.t('relay.settlementModeInterval')" /><el-option
                  value="daily"
                  :label="i18ns.t('relay.settlementModeDaily')" /><el-option
                  value="manual"
                  :label="i18ns.t('relay.settlementModeManual')" /></el-select
              ><el-input-number
                v-if="provider.settlementMode === 'interval'"
                v-model="provider.settlementIntervalDays"
                :min="1"
                :step="1"
                :placeholder="i18ns.t('relay.providerIntervalDays')"
              /><el-time-picker
                v-else-if="provider.settlementMode === 'daily'"
                v-model="provider.settlementTime"
                value-format="HH:mm"
                format="HH:mm"
                :placeholder="i18ns.t('relay.providerSettlementTime')"
              /><el-button
                text
                type="danger"
                :icon="Delete"
                @click="form.providers.splice(index, 1)"
              />
            </div>
            <el-button plain size="small" :icon="Plus" @click="addProvider">{{
              i18ns.t('relay.providerAdd')
            }}</el-button>
            <div class="hint">
              {{ i18ns.t('relay.providerSubmitterAutoAdd') }}
            </div></el-collapse-item
          >
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
            <el-button plain size="small" :icon="Plus" @click="addTimeRule">{{
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
            <el-button plain size="small" :icon="Plus" @click="addContextRule">{{
              i18ns.t('relay.contextRuleAdd')
            }}</el-button></el-collapse-item
          >
        </el-collapse>
      </el-form>
      <template #footer
        ><el-button @click="formVisible = false">{{ i18ns.t('cancel') }}</el-button
        ><el-button type="primary" :loading="submitting" @click="saveForm">{{
          formMode === 'submit'
            ? i18ns.t('relay.submitChannel')
            : i18ns.t('relay.submitChangeRequest')
        }}</el-button></template
      >
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Delete, Edit, Plus, Refresh, Search, Wallet } from '@element-plus/icons-vue'
import { usePageDevice } from '@/composables/usePageDevice'
import { useMobileTableCardLabels } from '@/composables/useMobileTableCardLabels'
import { i18ns } from '@/locales'
import { Permission } from '@/constant/permission'
import { usePermissionStore } from '@/stores/permissionStore'
import { relayChannelService } from '@/service/relayChannelService'
import type {
  RelayChannelDto,
  RelayChannelProviderConfigRequest,
  RelayChannelProviderEarningDto,
  RelayChannelSubmissionStatus,
  RelayChannelUpstreamModelDto,
  TimePeriodMultiplierRule,
  ContextLengthMultiplierRule,
} from '@/client/types.gen'

const { isDesktop } = usePageDevice()
const permissionStore = usePermissionStore()
const canSubmit = permissionStore.hasPermission(Permission.RELAY_CHANNEL_SUBMIT)
const canReadEarnings = permissionStore.hasPermission(Permission.RELAY_CHANNEL_PROVIDER_READ)
const submittedChannels = ref<RelayChannelDto[]>([])
const changeRequests = ref<any[]>([])
const earningRecords = ref<RelayChannelProviderEarningDto[]>([])
const submissionsLoading = ref(false)
const changeRequestsLoading = ref(false)
const earningsLoading = ref(false)
const submitting = ref(false)
const claiming = ref(false)
const formVisible = ref(false)
const formMode = ref<'submit' | 'change'>('submit')
const editingChannelId = ref<string>()
const expandedSections = ref(['formats', 'upstreams', 'parameters', 'providers'])
const submissionPage = reactive({ page: 1, pageSize: 20, total: 0 })
const changeRequestPage = reactive({ page: 1, pageSize: 20, total: 0 })
const earningsPage = reactive({ page: 1, pageSize: 20, total: 0 })
const pendingAmount = ref(0)
const settledAmount = ref(0)
type Format = 'openai' | 'anthropic' | 'gemini'
const formats: Format[] = ['openai', 'anthropic', 'gemini']
type FormState = {
  name: string
  formats: Format[]
  urls: Record<Format, string>
  keys: Record<Format, string>
  hasKeys: Record<Format, boolean>
  multiplier: number
  inputTokensIncludeCacheRead: boolean
  allowedModels: string[]
  providers: RelayChannelProviderConfigRequest[]
  mappings: Array<{ source: string; target: string }>
  timePeriodMultipliers: TimePeriodMultiplierRule[]
  contextLengthMultipliers: ContextLengthMultiplierRule[]
}
const emptyForm = (): FormState => ({
  name: '',
  formats: ['openai'],
  urls: { openai: '', anthropic: '', gemini: '' },
  keys: { openai: '', anthropic: '', gemini: '' },
  hasKeys: { openai: false, anthropic: false, gemini: false },
  multiplier: 1,
  inputTokensIncludeCacheRead: false,
  allowedModels: [],
  providers: [],
  mappings: [],
  timePeriodMultipliers: [],
  contextLengthMultipliers: [],
})
const form = reactive<FormState>(emptyForm())
const probeLoading = reactive<Record<Format, boolean>>({
  openai: false,
  anthropic: false,
  gemini: false,
})
const probeResults = reactive<Record<Format, RelayChannelUpstreamModelDto[]>>({
  openai: [],
  anthropic: [],
  gemini: [],
})
const selectedProbeModels = reactive<Record<Format, string[]>>({
  openai: [],
  anthropic: [],
  gemini: [],
})
const formatDateTime = (value: string) => new Date(value).toLocaleString()
const providerTotal = (
  providers?: RelayChannelProviderConfigRequest[] | RelayChannelDto['providers'],
) => (providers || []).reduce((sum, provider) => sum + Number(provider.commissionPercent || 0), 0)
const statusType = (status: RelayChannelSubmissionStatus) =>
  ({ approved: 'success', rejected: 'danger', offboarded: 'info', pending: 'warning' })[
    status
  ] as any
const statusLabel = (status: RelayChannelSubmissionStatus) =>
  i18ns.t(
    (
      {
        pending: 'relay.submissionStatusPending',
        approved: 'relay.submissionStatusApproved',
        rejected: 'relay.submissionStatusRejected',
        offboarded: 'relay.submissionStatusOffboarded',
      } as const
    )[status],
  )
const changeStatusType = (status: string) =>
  (({ approved: 'success', rejected: 'danger', pending: 'warning' })[status] || 'info') as any
const changeStatusLabel = (status: string) =>
  i18ns.t(
    (
      {
        pending: 'relay.changeStatusPending',
        approved: 'relay.changeStatusApproved',
        rejected: 'relay.changeStatusRejected',
      } as const
    )[status as 'pending' | 'approved' | 'rejected'],
  )
const resetForm = () => Object.assign(form, emptyForm())
const hydrateForm = (channel: RelayChannelDto) => {
  resetForm()
  form.name = channel.name
  form.formats =
    channel.allowedFormats === 'all'
      ? ['openai', 'anthropic', 'gemini']
      : channel.allowedFormats
          .split(',')
          .filter((value): value is Format => formats.includes(value as Format))
  form.urls.openai = channel.openaiUpstreamUrl || ''
  form.urls.anthropic = channel.anthropicUpstreamUrl || ''
  form.urls.gemini = channel.geminiUpstreamUrl || ''
  form.hasKeys.openai = channel.hasOpenaiUpstreamApiKey
  form.hasKeys.anthropic = channel.hasAnthropicUpstreamApiKey
  form.hasKeys.gemini = channel.hasGeminiUpstreamApiKey
  form.multiplier = channel.multiplier
  form.inputTokensIncludeCacheRead = channel.inputTokensIncludeCacheRead === true
  try {
    form.allowedModels = channel.configuredAllowedModels
      ? JSON.parse(channel.configuredAllowedModels)
      : []
  } catch {
    form.allowedModels = []
  }
  form.providers = (channel.providers || []).map((provider) => ({
    userId: provider.userId,
    commissionPercent: provider.commissionPercent,
    settlementMode: provider.settlementMode,
    settlementIntervalDays: provider.settlementIntervalDays,
    settlementTime: provider.settlementTime,
  }))
  form.mappings = Object.entries((channel.modelMapping || {}) as Record<string, string>).map(
    ([source, target]) => ({ source, target }),
  )
  form.timePeriodMultipliers = [...(channel.timePeriodMultipliers || [])]
  form.contextLengthMultipliers = [...(channel.contextLengthMultipliers || [])]
}
const openSubmission = () => {
  formMode.value = 'submit'
  editingChannelId.value = undefined
  resetForm()
  formVisible.value = true
}
const openChangeRequest = (channel: RelayChannelDto) => {
  formMode.value = 'change'
  editingChannelId.value = channel.id
  hydrateForm(channel)
  form.keys.openai = ''
  form.keys.anthropic = ''
  form.keys.gemini = ''
  formVisible.value = true
}
const payload = () => {
  const mappings = Object.fromEntries(
    form.mappings
      .filter((item) => item.source.trim() && item.target.trim())
      .map((item) => [item.source.trim(), item.target.trim()]),
  )
  const result = {
    name: form.name.trim(),
    allowedFormats: form.formats.join(','),
    allowedModels: form.allowedModels.length
      ? JSON.stringify([...new Set(form.allowedModels)])
      : null,
    multiplier: form.multiplier,
    inputTokensIncludeCacheRead: form.inputTokensIncludeCacheRead,
    modelMapping: Object.keys(mappings).length ? mappings : null,
    timePeriodMultipliers: form.timePeriodMultipliers,
    contextLengthMultipliers: form.contextLengthMultipliers,
    providers: form.providers
      .filter((provider) => provider.userId.trim())
      .map((provider) => ({ ...provider, userId: provider.userId.trim() })),
    openaiUpstreamUrl: form.urls.openai || undefined,
    openaiUpstreamApiKey: form.keys.openai || undefined,
    anthropicUpstreamUrl: form.urls.anthropic || undefined,
    anthropicUpstreamApiKey: form.keys.anthropic || undefined,
    geminiUpstreamUrl: form.urls.gemini || undefined,
    geminiUpstreamApiKey: form.keys.gemini || undefined,
  }
  return result
}
const saveForm = async () => {
  if (!form.name.trim() || !form.formats.length)
    return ElMessage.error(i18ns.t('relay.submissionRequired'))
  for (const format of form.formats)
    if (
      !form.urls[format] ||
      (formMode.value === 'submit' && !form.keys[format] && !form.hasKeys[format])
    )
      return ElMessage.error(i18ns.t('relay.submissionRequired'))
  submitting.value = true
  try {
    if (formMode.value === 'submit') await relayChannelService.submitChannel(payload())
    else if (editingChannelId.value)
      await relayChannelService.createChangeRequest(editingChannelId.value, payload())
    formVisible.value = false
    ElMessage.success(
      i18ns.t(
        formMode.value === 'submit' ? 'relay.submissionSuccess' : 'relay.changeRequestSubmitted',
      ),
    )
    await Promise.all([loadSubmissions(1), loadChangeRequests(1)])
  } catch (error: any) {
    ElMessage.error(error?.message || i18ns.t('operationFailed'))
  } finally {
    submitting.value = false
  }
}
const addProvider = () =>
  form.providers.push({ userId: '', commissionPercent: 0, settlementMode: 'manual' })
const addTimeRule = () =>
  form.timePeriodMultipliers.push({
    name: '',
    enabled: true,
    dayOfWeek: '1,2,3,4,5',
    startTime: '00:00',
    endTime: '23:59',
    multiplier: 1,
  })
const addContextRule = () =>
  form.contextLengthMultipliers.push({ name: '', enabled: true, minTokens: 0, multiplier: 1 })
const probeModels = async (format: Format) => {
  probeLoading[format] = true
  try {
    const result = await relayChannelService.listUpstreamModels({
      format,
      upstreamUrl: form.urls[format] || undefined,
      apiKey: form.keys[format] || undefined,
      channelId: formMode.value === 'change' ? editingChannelId.value : undefined,
    })
    probeResults[format] = result.models
    selectedProbeModels[format] = result.models
      .filter((model) => model.matched)
      .map((model) => model.pricingModel || model.id)
    ElMessage.success(i18ns.t('relay.modelDiscoverySuccess'))
  } catch (error: any) {
    ElMessage.error(error?.message || i18ns.t('relay.loadFailed'))
  } finally {
    probeLoading[format] = false
  }
}
const addProbeModels = (format: Format) => {
  form.allowedModels = [...new Set([...form.allowedModels, ...selectedProbeModels[format]])]
  ElMessage.success(i18ns.t('relay.modelsAdded'))
}
const loadSubmissions = async (page = submissionPage.page) => {
  submissionsLoading.value = true
  try {
    const data = await relayChannelService.listMySubmittedChannels({
      page,
      pageSize: submissionPage.pageSize,
    })
    submittedChannels.value = data.items
    Object.assign(submissionPage, { page: data.page, total: data.total })
  } catch (error: any) {
    ElMessage.error(error?.message || i18ns.t('relay.loadFailed'))
  } finally {
    submissionsLoading.value = false
  }
}
const loadChangeRequests = async (page = changeRequestPage.page) => {
  changeRequestsLoading.value = true
  try {
    const data = await relayChannelService.listMyChangeRequests({
      page,
      pageSize: changeRequestPage.pageSize,
    })
    changeRequests.value = data.items
    Object.assign(changeRequestPage, { page: data.page, total: data.total })
  } catch (error: any) {
    ElMessage.error(error?.message || i18ns.t('relay.loadFailed'))
  } finally {
    changeRequestsLoading.value = false
  }
}
const loadEarnings = async (page = earningsPage.page) => {
  earningsLoading.value = true
  try {
    const data = await relayChannelService.getMyProviderEarnings({
      page,
      pageSize: earningsPage.pageSize,
    })
    earningRecords.value = data.records
    pendingAmount.value = data.pendingAmount
    settledAmount.value = data.settledAmount
    Object.assign(earningsPage, { page: data.page, total: data.total })
  } catch (error: any) {
    ElMessage.error(error?.message || i18ns.t('relay.loadFailed'))
  } finally {
    earningsLoading.value = false
  }
}
const claim = async () => {
  claiming.value = true
  try {
    await relayChannelService.claimMyProviderEarnings()
    ElMessage.success(i18ns.t('relay.claimSuccess'))
    await loadEarnings(1)
  } catch (error: any) {
    ElMessage.error(error?.message || i18ns.t('operationFailed'))
  } finally {
    claiming.value = false
  }
}
onMounted(() => {
  void loadSubmissions()
  if (canSubmit) void loadChangeRequests()
  if (canReadEarnings) void loadEarnings()
})
if (!isDesktop.value) useMobileTableCardLabels('.relay-provider-page')
</script>

<style scoped lang="scss">
.relay-provider-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  min-width: 0;
}
.surface-card {
  border: 1px solid var(--surface-card-border);
  border-radius: 8px;
  background: var(--surface-card-bg);
  box-shadow: var(--surface-card-shadow);
}
.page-heading,
.section-heading {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}
h2,
h3 {
  margin: 0;
  color: var(--el-text-color-primary);
}
h2 {
  font-size: 20px;
}
h3 {
  font-size: 17px;
}
.page-heading p {
  margin: 6px 0 0;
  color: var(--el-text-color-secondary);
  line-height: 1.5;
}
.pagination {
  justify-content: flex-end;
  margin-top: 16px;
}
.stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}
.stats > div {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  padding: 12px;
  background: var(--el-fill-color-light);
}
.stats span {
  display: block;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.stats strong {
  display: block;
  margin-top: 4px;
  font-size: 20px;
  color: var(--el-text-color-primary);
}
.provider-form :deep(.el-collapse-item__header) {
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
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
  padding: 12px;
  margin-bottom: 12px;
}
.upstream-block h4 {
  margin: 0 0 10px;
  color: var(--el-text-color-primary);
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
  padding: 10px;
  border-radius: 6px;
  background: var(--el-fill-color-light);
}
.model-results :deep(.el-checkbox-group) {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 8px;
}
.model-results :deep(.el-checkbox) {
  margin-right: 0;
}
.provider-summary {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.provider-row,
.mapping-row,
.rule-row {
  display: grid;
  grid-template-columns:
    minmax(140px, 1.5fr) minmax(90px, 120px) minmax(130px, 1fr) minmax(100px, 140px)
    auto;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}
.mapping-row {
  grid-template-columns: 1fr 1fr auto;
}
.rule-row {
  grid-template-columns: 1.3fr 1fr 1fr 110px 70px auto;
}
.mobile-adapter {
  padding: 8px 6px 16px;
  overflow-x: hidden;
}
.mobile-adapter :deep(.el-table__header-wrapper),
.mobile-adapter :deep(.el-table__scrollbar),
.mobile-adapter :deep(.el-table colgroup) {
  display: none !important;
}
.mobile-adapter :deep(.el-table__body tbody) {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.mobile-adapter :deep(.el-table__body tr) {
  display: block;
  width: 100% !important;
  padding: 10px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background: var(--el-fill-color-blank);
}
.mobile-adapter :deep(.el-table__body td) {
  display: block;
  border: none !important;
  padding: 5px 0;
}
.mobile-adapter :deep(.el-table__body td::before) {
  content: attr(data-label);
  display: block;
  margin-bottom: 2px;
  color: var(--el-text-color-secondary);
  font-size: 11px;
  font-weight: 600;
}
@media (max-width: 768px) {
  .relay-provider-page {
    gap: 12px;
  }
  .page-heading {
    flex-direction: column;
  }
  .page-heading .el-button {
    width: 100%;
  }
  .stats {
    grid-template-columns: 1fr;
  }
  .provider-row,
  .mapping-row,
  .rule-row {
    grid-template-columns: 1fr;
  }
  .relay-provider-dialog :deep(.el-dialog) {
    width: 96% !important;
  }
  .relay-provider-dialog :deep(.el-dialog__body) {
    max-height: 72vh;
    overflow: auto;
  }
  .pagination {
    justify-content: center;
    flex-wrap: wrap;
  }
}
</style>
