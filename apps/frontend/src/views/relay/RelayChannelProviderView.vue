<template>
  <div
    :class="[
      isDesktop ? 'desktop-page page-shell' : 'mobile-page mobile-adapter',
      'relay-provider-page',
    ]"
  >
    <el-card shadow="never" class="page-card surface-card relay-provider-page__section">
      <template #header>
        <div class="relay-provider-page__heading">
          <div>
            <h2>{{ i18ns.t('relay.providerChannelTitle') }}</h2>
            <p>{{ i18ns.t('relay.providerChannelDescription') }}</p>
          </div>
          <el-button
            v-if="canSubmit"
            type="primary"
            :loading="submitting"
            @click="submissionDialogVisible = true"
          >
            {{ i18ns.t('relay.submitChannel') }}
          </el-button>
        </div>
      </template>

      <el-table v-loading="submissionsLoading" :data="submittedChannels" size="small">
        <el-table-column prop="name" :label="i18ns.t('relay.channelName')" min-width="180" />
        <el-table-column :label="i18ns.t('relay.submissionStatus')" width="140">
          <template #default="{ row }">
            <el-tag :type="submissionStatusType(row.submissionStatus)">
              {{ submissionStatusLabel(row.submissionStatus) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="i18ns.t('relay.reviewReason')" min-width="180">
          <template #default="{ row }">{{ row.reviewReason || '-' }}</template>
        </el-table-column>
        <el-table-column :label="i18ns.t('relay.updateTime')" width="180">
          <template #default="{ row }">{{ formatDateTime(row.updateTime) }}</template>
        </el-table-column>
      </el-table>
      <el-pagination
        class="relay-provider-page__pagination"
        background
        layout="total, prev, pager, next"
        :current-page="submissionPage.page"
        :page-size="submissionPage.pageSize"
        :total="submissionPage.total"
        @update:current-page="loadSubmissions($event)"
      />
    </el-card>

    <el-card
      v-if="canReadEarnings"
      shadow="never"
      class="page-card surface-card relay-provider-page__section"
    >
      <template #header>
        <div class="relay-provider-page__heading">
          <div>
            <h2>{{ i18ns.t('relay.providerEarningsTitle') }}</h2>
            <p>{{ i18ns.t('relay.providerEarningsDescription') }}</p>
          </div>
          <el-button
            type="primary"
            :disabled="pendingAmount <= 0"
            :loading="claiming"
            @click="claim"
          >
            {{ i18ns.t('relay.claimProviderEarnings') }}
          </el-button>
        </div>
      </template>
      <div class="relay-provider-page__stats">
        <div>
          <span>{{ i18ns.t('relay.pendingEarnings') }}</span
          ><strong>{{ pendingAmount }}</strong>
        </div>
        <div>
          <span>{{ i18ns.t('relay.settledEarnings') }}</span
          ><strong>{{ settledAmount }}</strong>
        </div>
      </div>
      <el-table v-loading="earningsLoading" :data="earningRecords" size="small">
        <el-table-column prop="channelName" :label="i18ns.t('relay.channelName')" min-width="160" />
        <el-table-column prop="grossAmount" :label="i18ns.t('relay.grossCharge')" width="130" />
        <el-table-column :label="i18ns.t('relay.providerCommission')" width="130">
          <template #default="{ row }">{{ row.commissionPercent }}%</template>
        </el-table-column>
        <el-table-column
          prop="commissionAmount"
          :label="i18ns.t('relay.earningAmount')"
          width="130"
        />
        <el-table-column :label="i18ns.t('status')" width="110">
          <template #default="{ row }"
            ><el-tag :type="row.settled ? 'success' : 'warning'">{{
              row.settled ? i18ns.t('relay.settled') : i18ns.t('relay.pending')
            }}</el-tag></template
          >
        </el-table-column>
        <el-table-column :label="i18ns.t('relay.createTime')" width="180">
          <template #default="{ row }">{{ formatDateTime(row.createTime) }}</template>
        </el-table-column>
      </el-table>
      <el-pagination
        class="relay-provider-page__pagination"
        background
        layout="total, prev, pager, next"
        :current-page="earningsPage.page"
        :page-size="earningsPage.pageSize"
        :total="earningsPage.total"
        @update:current-page="loadEarnings($event)"
      />
    </el-card>

    <el-dialog
      v-model="submissionDialogVisible"
      :title="i18ns.t('relay.submitChannel')"
      width="min(680px, 92vw)"
    >
      <el-form :model="submissionForm" label-position="top">
        <el-form-item :label="i18ns.t('relay.channelName')" required
          ><el-input v-model="submissionForm.name"
        /></el-form-item>
        <el-form-item :label="i18ns.t('relay.allowedFormats')">
          <el-checkbox-group v-model="submissionForm.formats"
            ><el-checkbox value="openai">OpenAI</el-checkbox
            ><el-checkbox value="anthropic">Anthropic</el-checkbox
            ><el-checkbox value="gemini">Gemini</el-checkbox></el-checkbox-group
          >
        </el-form-item>
        <template v-if="submissionForm.formats.includes('openai')"
          ><el-form-item label="OpenAI URL" required
            ><el-input v-model="submissionForm.openaiUpstreamUrl" /></el-form-item
          ><el-form-item label="OpenAI API Key" required
            ><el-input v-model="submissionForm.openaiUpstreamApiKey" show-password /></el-form-item
        ></template>
        <template v-if="submissionForm.formats.includes('anthropic')"
          ><el-form-item label="Anthropic URL" required
            ><el-input v-model="submissionForm.anthropicUpstreamUrl" /></el-form-item
          ><el-form-item label="Anthropic API Key" required
            ><el-input
              v-model="submissionForm.anthropicUpstreamApiKey"
              show-password /></el-form-item
        ></template>
        <template v-if="submissionForm.formats.includes('gemini')"
          ><el-form-item label="Gemini URL" required
            ><el-input v-model="submissionForm.geminiUpstreamUrl" /></el-form-item
          ><el-form-item label="Gemini API Key" required
            ><el-input v-model="submissionForm.geminiUpstreamApiKey" show-password /></el-form-item
        ></template>
      </el-form>
      <template #footer
        ><el-button @click="submissionDialogVisible = false">{{ i18ns.t('cancel') }}</el-button
        ><el-button type="primary" :loading="submitting" @click="submit">{{
          i18ns.t('relay.submitChannel')
        }}</el-button></template
      >
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { useMobileTableCardLabels } from '@/composables/useMobileTableCardLabels'
import { usePageDevice } from '@/composables/usePageDevice'
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import type {
  RelayChannelDto,
  RelayChannelProviderEarningDto,
  RelayChannelSubmissionStatus,
} from '@/client/types.gen'
import { i18ns } from '@/locales'
import { relayChannelService } from '@/service/relayChannelService'
import { Permission } from '@/constant/permission'
import { usePermissionStore } from '@/stores/permissionStore'

const permissionStore = usePermissionStore()
const { isDesktop } = usePageDevice()
const canSubmit = permissionStore.hasPermission(Permission.RELAY_CHANNEL_SUBMIT)
const canReadEarnings = permissionStore.hasPermission(Permission.RELAY_CHANNEL_PROVIDER_READ)
const submittedChannels = ref<RelayChannelDto[]>([])
const earningRecords = ref<RelayChannelProviderEarningDto[]>([])
const submissionsLoading = ref(false)
const earningsLoading = ref(false)
const submitting = ref(false)
const claiming = ref(false)
const submissionDialogVisible = ref(false)
const submissionPage = reactive({ page: 1, pageSize: 20, total: 0 })
const earningsPage = reactive({ page: 1, pageSize: 20, total: 0 })
const pendingAmount = ref(0)
const settledAmount = ref(0)
const submissionForm = reactive({
  name: '',
  formats: ['openai'],
  openaiUpstreamUrl: '',
  openaiUpstreamApiKey: '',
  anthropicUpstreamUrl: '',
  anthropicUpstreamApiKey: '',
  geminiUpstreamUrl: '',
  geminiUpstreamApiKey: '',
})

const formatDateTime = (value: string) => new Date(value).toLocaleString()
const submissionStatusType = (status: RelayChannelSubmissionStatus) =>
  ({ approved: 'success', rejected: 'danger', offboarded: 'info', pending: 'warning' })[status] as
    | 'success'
    | 'danger'
    | 'info'
    | 'warning'
const submissionStatusLabel = (status: RelayChannelSubmissionStatus) => {
  const labels = {
    pending: 'relay.submissionStatusPending',
    approved: 'relay.submissionStatusApproved',
    rejected: 'relay.submissionStatusRejected',
    offboarded: 'relay.submissionStatusOffboarded',
  } as const
  return i18ns.t(labels[status])
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
    ElMessage.error(error.message || i18ns.t('relay.loadFailed'))
  } finally {
    submissionsLoading.value = false
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
    ElMessage.error(error.message || i18ns.t('relay.loadFailed'))
  } finally {
    earningsLoading.value = false
  }
}
const submit = async () => {
  if (!submissionForm.name.trim() || submissionForm.formats.length === 0) {
    ElMessage.error(i18ns.t('relay.submissionRequired'))
    return
  }
  for (const format of submissionForm.formats) {
    if (
      !submissionForm[`${format}UpstreamUrl` as keyof typeof submissionForm] ||
      !submissionForm[`${format}UpstreamApiKey` as keyof typeof submissionForm]
    ) {
      ElMessage.error(i18ns.t('relay.submissionRequired'))
      return
    }
  }
  submitting.value = true
  try {
    await relayChannelService.submitChannel({
      name: submissionForm.name.trim(),
      allowedFormats: submissionForm.formats.join(','),
      openaiUpstreamUrl: submissionForm.openaiUpstreamUrl || undefined,
      openaiUpstreamApiKey: submissionForm.openaiUpstreamApiKey || undefined,
      anthropicUpstreamUrl: submissionForm.anthropicUpstreamUrl || undefined,
      anthropicUpstreamApiKey: submissionForm.anthropicUpstreamApiKey || undefined,
      geminiUpstreamUrl: submissionForm.geminiUpstreamUrl || undefined,
      geminiUpstreamApiKey: submissionForm.geminiUpstreamApiKey || undefined,
    })
    submissionDialogVisible.value = false
    Object.assign(submissionForm, {
      name: '',
      formats: ['openai'],
      openaiUpstreamUrl: '',
      openaiUpstreamApiKey: '',
      anthropicUpstreamUrl: '',
      anthropicUpstreamApiKey: '',
      geminiUpstreamUrl: '',
      geminiUpstreamApiKey: '',
    })
    ElMessage.success(i18ns.t('relay.submissionSuccess'))
    await loadSubmissions(1)
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('relay.createFailed'))
  } finally {
    submitting.value = false
  }
}
const claim = async () => {
  claiming.value = true
  try {
    const result = await relayChannelService.claimMyProviderEarnings()
    ElMessage.success(i18ns.t('relay.claimSuccess', { amount: result.settledAmount }))
    await loadEarnings(1)
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('operationFailed'))
  } finally {
    claiming.value = false
  }
}
onMounted(() => {
  void loadSubmissions()
  if (canReadEarnings) void loadEarnings()
})

if (!isDesktop.value) {
  useMobileTableCardLabels('.relay-provider-page')
}
</script>

<style scoped lang="scss">
.relay-provider-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  min-width: 0;
}
.relay-provider-page__section {
  overflow: hidden;
}

.relay-provider-page :deep(.surface-card) {
  border: 1px solid var(--surface-card-border);
  border-radius: 8px;
  background-color: var(--surface-card-bg);
  box-shadow: var(--surface-card-shadow);
  backdrop-filter: blur(var(--surface-card-blur));
}

.relay-provider-page__heading {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
}
.relay-provider-page__heading h2 {
  margin: 0;
  font-size: 20px;
  line-height: 1.35;
  color: var(--el-text-color-primary);
}
.relay-provider-page__heading p {
  margin: 6px 0 0;
  color: var(--el-text-color-secondary);
  line-height: 1.5;
}
.relay-provider-page__stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}
.relay-provider-page__stats > div {
  border: 1px solid var(--el-border-color-lighter);
  padding: 12px;
  display: grid;
  gap: 4px;
  border-radius: 8px;
  background: var(--el-fill-color-light);
}
.relay-provider-page__stats span {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.relay-provider-page__stats strong {
  font-size: 20px;
  line-height: 1.25;
  color: var(--el-text-color-primary);
}
.relay-provider-page__pagination {
  justify-content: flex-end;
  margin-top: 16px;
}

.relay-provider-page :deep(.el-card__header) {
  padding: 16px 20px;
}

.relay-provider-page :deep(.el-card__body) {
  padding: 16px 20px 20px;
}

.relay-provider-page :deep(.el-table) {
  background-color: transparent;
}

@media (max-width: 768px) {
  .relay-provider-page {
    gap: 12px;
  }

  .relay-provider-page__section {
    border-radius: 8px;
  }

  .relay-provider-page :deep(.el-card__header),
  .relay-provider-page :deep(.el-card__body) {
    padding: 12px 14px;
  }

  .relay-provider-page__heading {
    flex-direction: column;
    gap: 10px;
  }

  .relay-provider-page__heading h2 {
    font-size: 18px;
  }

  .relay-provider-page__heading .el-button {
    width: 100%;
  }

  .relay-provider-page__stats {
    grid-template-columns: 1fr;
    gap: 8px;
  }

  .relay-provider-page__pagination {
    justify-content: center;
    flex-wrap: wrap;
    gap: 8px;
  }
}

.mobile-adapter {
  padding: 8px 6px 16px;
  overflow-x: hidden;
}

.mobile-adapter :deep(.el-table__header-wrapper),
.mobile-adapter :deep(.el-table__scrollbar),
.mobile-adapter :deep(.el-table__body colgroup),
.mobile-adapter :deep(.el-table__header colgroup) {
  display: none !important;
}

.mobile-adapter :deep(.el-table__inner-wrapper),
.mobile-adapter :deep(.el-table__body-wrapper),
.mobile-adapter :deep(.el-table__body-wrapper .el-scrollbar),
.mobile-adapter :deep(.el-table__body-wrapper .el-scrollbar__wrap),
.mobile-adapter :deep(.el-table__body-wrapper .el-scrollbar__view) {
  overflow-x: hidden !important;
}

.mobile-adapter :deep(.el-table__body-wrapper) {
  overflow-y: visible !important;
  padding: 4px 0 10px;
}

.mobile-adapter :deep(.el-table__body tbody) {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.mobile-adapter :deep(.el-table__body tr) {
  display: block;
  width: 100% !important;
  margin: 0;
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

.mobile-adapter :deep(.el-dialog) {
  width: 96% !important;
  max-width: 96% !important;
  margin-top: 3vh !important;
}

.mobile-adapter :deep(.el-dialog__body) {
  max-height: 72vh;
  overflow: auto;
  padding: 12px 14px;
}

.mobile-adapter :deep(.el-form-item__label) {
  float: none;
  display: block;
  text-align: left;
  padding: 0 0 6px;
}

.mobile-adapter :deep(.el-form-item__content) {
  margin-left: 0 !important;
}
</style>
