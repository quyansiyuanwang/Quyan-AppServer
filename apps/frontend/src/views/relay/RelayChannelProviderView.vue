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
          <el-button v-if="canSubmit" type="primary" :icon="Plus" @click="openSubmission">{{
            i18ns.t('relay.submitChannel')
          }}</el-button>
        </div>
      </template>
      <el-table v-loading="submissionsLoading" :data="submittedChannels" size="small">
        <el-table-column prop="name" :label="i18ns.t('relay.channelName')" min-width="180" />
        <el-table-column :label="i18ns.t('relay.submissionStatus')" width="130"
          ><template #default="{ row }"
            ><el-tag :type="submissionStatusType(row.submissionStatus)">{{
              submissionStatusLabel(row.submissionStatus)
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
        <el-table-column :label="i18ns.t('relay.submitChangeRequest')" min-width="180">
          <template #default="{ row }">
            <template v-if="changeRequestByChannel.get(row.id)">
              <el-tag :type="changeStatusType(changeRequestByChannel.get(row.id)!.reviewStatus)">
                {{ changeStatusLabel(changeRequestByChannel.get(row.id)!.reviewStatus) }}
              </el-tag>
              <span v-if="changeRequestByChannel.get(row.id)!.reviewReason" class="inline-reason">
                {{ changeRequestByChannel.get(row.id)!.reviewReason }}
              </span>
            </template>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column :label="i18ns.t('actions')" width="180" fixed="right"
          ><template #default="{ row }"
            ><el-button
              v-if="row.submissionStatus === 'approved'"
              size="small"
              :icon="Edit"
              :disabled="changeRequestByChannel.get(row.id)?.reviewStatus === 'pending'"
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

    <el-card v-if="canReadEarnings" shadow="never" class="page-card surface-card">
      <template #header
        ><div class="page-heading">
          <div>
            <h2>{{ i18ns.t('relay.providerEarningsTitle') }}</h2>
            <p>{{ i18ns.t('relay.providerEarningsDescription') }}</p>
          </div>
          <el-button
            v-if="canSettleEarnings"
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

    <RelayChannelConfigDrawer
      v-model="formVisible"
      :form="form"
      :mode="formMode"
      :submitting="submitting"
      :probe-loading="probeLoading"
      :probe-results="probeResults"
      :selected-probe-models="selectedProbeModels"
      @probe="probeModels"
      @add-probe-models="addProbeModels"
      @update-providers="form.providers = $event"
      @add-time-rule="addTimeRule"
      @add-context-rule="addContextRule"
      @save="saveForm"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Edit, Plus, Wallet } from '@element-plus/icons-vue'
import { usePageDevice } from '@/composables/usePageDevice'
import { useMobileTableCardLabels } from '@/composables/useMobileTableCardLabels'
import { i18ns } from '@/locales'
import { Permission } from '@/constant/permission'
import { usePermissionStore } from '@/stores/permissionStore'
import { relayChannelService } from '@/service/relayChannelService'
import RelayChannelConfigDrawer, {
  type RelayChannelConfigFormState,
} from './components/RelayChannelConfigDrawer.vue'
import type {
  RelayChannelDto,
  RelayChannelProviderConfigRequest,
  RelayChannelProviderEarningDto,
  RelayChannelSubmissionStatus,
  RelayChannelUpstreamModelDto,
} from '@/client/types.gen'

type Format = 'openai' | 'anthropic' | 'gemini'
const formats: Format[] = ['openai', 'anthropic', 'gemini']
const { isDesktop } = usePageDevice()
const permissionStore = usePermissionStore()
const canSubmit = permissionStore.hasPermission(Permission.RELAY_CHANNEL_SUBMIT)
const canReadEarnings = permissionStore.hasPermission(Permission.RELAY_CHANNEL_PROVIDER_READ)
const canSettleEarnings = permissionStore.hasPermission(Permission.RELAY_CHANNEL_PROVIDER_SETTLE)
const submittedChannels = ref<RelayChannelDto[]>([])
const changeRequests = ref<any[]>([])
const earningRecords = ref<RelayChannelProviderEarningDto[]>([])
const submissionsLoading = ref(false)
const earningsLoading = ref(false)
const submitting = ref(false)
const claiming = ref(false)
const formVisible = ref(false)
const formMode = ref<'submit' | 'change'>('submit')
const editingChannelId = ref<string>()
const submissionPage = reactive({ page: 1, pageSize: 20, total: 0 })
const earningsPage = reactive({ page: 1, pageSize: 20, total: 0 })
const pendingAmount = ref(0)
const settledAmount = ref(0)
const emptyForm = (): RelayChannelConfigFormState => ({
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
const form = reactive<RelayChannelConfigFormState>(emptyForm())
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
const changeRequestByChannel = computed(
  () => new Map(changeRequests.value.map((request) => [request.relayChannelId, request])),
)
const providerTotal = (
  providers?: RelayChannelProviderConfigRequest[] | RelayChannelDto['providers'],
) => (providers || []).reduce((sum, provider) => sum + Number(provider.commissionPercent || 0), 0)
const submissionStatusType = (status: RelayChannelSubmissionStatus) =>
  ({ approved: 'success', rejected: 'danger', offboarded: 'info', pending: 'warning' })[
    status
  ] as any
const submissionStatusLabel = (status: RelayChannelSubmissionStatus) =>
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
      ? [...formats]
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
  form.providers = channel.providers.map((provider) => ({
    username: provider.username || '',
    commissionPercent: provider.commissionPercent,
    settlementMode: provider.settlementMode,
    settlementIntervalDays: provider.settlementIntervalDays,
    settlementTime: provider.settlementTime,
  }))
  form.mappings = Object.entries(channel.modelMapping || {}).map(([source, target]) => ({
    source,
    target,
  }))
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
  return {
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
      .filter((provider) => provider.username.trim())
      .map((provider) => ({ ...provider, username: provider.username.trim() })),
    openaiUpstreamUrl: form.urls.openai || undefined,
    openaiUpstreamApiKey: form.keys.openai || undefined,
    anthropicUpstreamUrl: form.urls.anthropic || undefined,
    anthropicUpstreamApiKey: form.keys.anthropic || undefined,
    geminiUpstreamUrl: form.urls.gemini || undefined,
    geminiUpstreamApiKey: form.keys.gemini || undefined,
  }
}
const saveForm = async () => {
  if (!form.name.trim() || !form.formats.length)
    return ElMessage.error(i18ns.t('relay.submissionRequired'))
  for (const format of form.formats)
    if (!form.urls[format] || (formMode.value === 'submit' && !form.keys[format]))
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
    await Promise.all([loadSubmissions(1), loadChangeRequests()])
  } catch (error: any) {
    ElMessage.error(error?.message || i18ns.t('operationFailed'))
  } finally {
    submitting.value = false
  }
}
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
const loadChangeRequests = async () => {
  try {
    const data = await relayChannelService.listMyChangeRequests({
      page: 1,
      pageSize: 100,
    })
    changeRequests.value = data.items
  } catch (error: any) {
    ElMessage.error(error?.message || i18ns.t('relay.loadFailed'))
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
.page-heading h2,
.section-heading h3 {
  margin: 0;
  color: var(--el-text-color-primary);
}
.page-heading h2 {
  font-size: 20px;
}
.section-heading h3 {
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
.inline-reason {
  display: block;
  margin-top: 4px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.4;
  overflow-wrap: anywhere;
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
  color: var(--el-text-color-primary);
  font-size: 20px;
}
.mobile-adapter {
  padding: 8px 6px 16px;
  overflow-x: hidden;
}
@media (max-width: 768px) {
  .page-heading {
    flex-direction: column;
  }
  .page-heading .el-button {
    width: 100%;
  }
  .stats {
    grid-template-columns: 1fr;
  }
  .pagination {
    justify-content: center;
    flex-wrap: wrap;
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
}
</style>
