<template>
  <div
    :class="[
      isDesktop ? 'desktop-page page-shell' : 'mobile-page mobile-adapter',
      'relay-review-page',
    ]"
  >
    <el-card shadow="never" class="page-card surface-card">
      <template #header
        ><div class="page-heading">
          <div>
            <h2>{{ i18ns.t('relay.channelReviewTitle') }}</h2>
            <p>{{ i18ns.t('relay.channelReviewDescription') }}</p>
          </div>
          <el-button :icon="Refresh" text @click="refresh">{{ i18ns.t('refresh') }}</el-button>
        </div></template
      >
      <div class="review-toolbar">
        <el-select v-model="submissionFilter" size="small" @change="loadChannels(1)"
          ><el-option value="pending" :label="i18ns.t('relay.submissionStatusPending')" /><el-option
            value="approved"
            :label="i18ns.t('relay.submissionStatusApproved')" /><el-option
            value="rejected"
            :label="i18ns.t('relay.submissionStatusRejected')" /><el-option
            value="offboarded"
            :label="i18ns.t('relay.submissionStatusOffboarded')"
        /></el-select>
      </div>
      <div class="review-table">
        <el-table v-loading="channelsLoading" :data="channels" size="small"
          ><el-table-column
            prop="name"
            :label="i18ns.t('relay.channelName')"
            min-width="180"
          /><el-table-column
            prop="multiplier"
            :label="i18ns.t('relay.channelMultiplier')"
            width="110"
          /><el-table-column
            prop="providerCount"
            :label="i18ns.t('relay.providerCount')"
            width="100"
          /><el-table-column :label="i18ns.t('relay.submissionStatus')" width="120"
            ><template #default="{ row }"
              ><el-tag
                :type="
                  row.submissionStatus === 'approved'
                    ? 'success'
                    : row.submissionStatus === 'rejected'
                      ? 'danger'
                      : row.submissionStatus === 'offboarded'
                        ? 'info'
                        : 'warning'
                "
                >{{ row.submissionStatus }}</el-tag
              ></template
            ></el-table-column
          ><el-table-column :label="i18ns.t('relay.pendingChangeRequests')" min-width="240"
            ><template #default="{ row }"
              ><template v-if="changeRequestByChannel.get(row.id)"
                ><el-tag type="warning">{{ i18ns.t('relay.changeStatusPending') }}</el-tag
                ><el-button
                  text
                  type="primary"
                  :icon="View"
                  @click="showChange(changeRequestByChannel.get(row.id)!)"
                  >{{ i18ns.t('relay.viewChange') }}</el-button
                ><el-button
                  size="small"
                  type="success"
                  :icon="Check"
                  @click="reviewChange(changeRequestByChannel.get(row.id)!.id, 'approve')"
                  >{{ i18ns.t('relay.reviewApprove') }}</el-button
                ><el-button
                  size="small"
                  type="danger"
                  :icon="Close"
                  @click="reviewChange(changeRequestByChannel.get(row.id)!.id, 'reject')"
                  >{{ i18ns.t('relay.reviewReject') }}</el-button
                ></template
              ><span v-else>-</span></template
            ></el-table-column
          ><el-table-column :label="i18ns.t('actions')" min-width="300" fixed="right"
            ><template #default="{ row }"
              ><el-button
                v-if="row.submissionStatus === 'pending'"
                size="small"
                type="success"
                :icon="Check"
                @click="reviewSubmission(row.id, 'approve')"
                >{{ i18ns.t('relay.reviewApprove') }}</el-button
              ><el-button
                v-if="row.submissionStatus === 'pending'"
                size="small"
                type="danger"
                :icon="Close"
                @click="reviewSubmission(row.id, 'reject')"
                >{{ i18ns.t('relay.reviewReject') }}</el-button
              ><el-button
                v-if="row.submissionStatus === 'approved'"
                size="small"
                type="warning"
                :icon="Close"
                @click="reviewSubmission(row.id, 'offboard')"
                >{{ i18ns.t('relay.reviewOffboard') }}</el-button
              ><el-button size="small" :icon="Setting" @click="openConfig(row.id)">{{
                i18ns.t('relay.reviewConfigure')
              }}</el-button></template
            ></el-table-column
          ></el-table
        >
        <el-pagination
          class="pagination"
          background
          layout="total, prev, pager, next"
          :current-page="channelPage.page"
          :page-size="channelPage.pageSize"
          :total="channelPage.total"
          @update:current-page="loadChannels"
        />
      </div>
    </el-card>

    <el-drawer
      v-model="configVisible"
      :title="i18ns.t('relay.reviewConfigure')"
      direction="rtl"
      size="min(760px, 94vw)"
      class="relay-review-config-drawer"
      ><el-form v-if="configChannel" label-position="top"
        ><el-form-item :label="i18ns.t('relay.channelMultiplier')"
          ><el-input-number
            v-model="configMultiplier"
            :min="0.000001"
            :step="0.01"
            :precision="6" /></el-form-item
        ><el-divider content-position="left">{{ i18ns.t('relay.providers') }}</el-divider
        ><el-alert
          type="warning"
          :closable="false"
          :title="i18ns.t('relay.providerCommissionWarning')"
          class="mb-3"
        />
        <RelayProviderShareEditor
          :providers="configProviders"
          @update:providers="configProviders = $event"
        /> </el-form
      ><template #footer
        ><div class="drawer-footer">
          <el-button @click="configVisible = false">{{ i18ns.t('cancel') }}</el-button
          ><el-button type="primary" @click="saveConfig">{{ i18ns.t('save') }}</el-button>
        </div></template
      ></el-drawer
    >
    <el-dialog v-model="changeVisible" :title="i18ns.t('relay.reviewDiff')" width="min(760px, 94vw)"
      ><el-descriptions v-if="selectedChange" :column="1" border
        ><el-descriptions-item :label="i18ns.t('relay.channelName')">{{
          selectedChange.channelName
        }}</el-descriptions-item
        ><el-descriptions-item :label="i18ns.t('relay.allowedFormats')">{{
          selectedChange.config.allowedFormats || 'all'
        }}</el-descriptions-item
        ><el-descriptions-item :label="i18ns.t('relay.channelMultiplier')">{{
          selectedChange.config.multiplier ?? '-'
        }}</el-descriptions-item
        ><el-descriptions-item :label="i18ns.t('relay.upstreamSettings')">{{
          credentialSummary(selectedChange.config)
        }}</el-descriptions-item
        ><el-descriptions-item :label="i18ns.t('relay.providers')">{{
          providerSummary(selectedChange.config.providers)
        }}</el-descriptions-item
        ><el-descriptions-item :label="i18ns.t('relay.allowedModelsChannel')">{{
          selectedChange.config.allowedModels || i18ns.t('relay.noModels')
        }}</el-descriptions-item></el-descriptions
      ></el-dialog
    >
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Check, Close, Refresh, Setting, View } from '@element-plus/icons-vue'
import { usePageDevice } from '@/composables/usePageDevice'
import { useMobileTableCardLabels } from '@/composables/useMobileTableCardLabels'
import { i18ns } from '@/locales'
import { relayChannelService } from '@/service/relayChannelService'
import RelayProviderShareEditor from './components/RelayProviderShareEditor.vue'
import type {
  RelayChannelManagementListItemDto,
  RelayChannelDto,
  RelayChannelProviderConfigRequest,
  RelayChannelChangeRequestDto,
} from '@/client/types.gen'

const { isDesktop } = usePageDevice()
const submissionFilter = ref<'pending' | 'approved' | 'rejected' | 'offboarded'>('pending')
const channels = ref<RelayChannelManagementListItemDto[]>([])
const changeRequests = ref<RelayChannelChangeRequestDto[]>([])
const channelsLoading = ref(false)
const channelPage = reactive({ page: 1, pageSize: 20, total: 0 })
const configVisible = ref(false)
const configChannel = ref<RelayChannelDto | null>(null)
const configMultiplier = ref(1)
const configProviders = ref<RelayChannelProviderConfigRequest[]>([])
const changeVisible = ref(false)
const selectedChange = ref<RelayChannelChangeRequestDto | null>(null)
const changeRequestByChannel = computed(
  () => new Map(changeRequests.value.map((request) => [request.relayChannelId, request])),
)
const providerSummary = (providers?: RelayChannelProviderConfigRequest[]) =>
  (providers || []).map((item) => `${item.username}: ${item.commissionPercent}%`).join(', ') || '-'
const credentialSummary = (config: any) =>
  (
    [
      ['openai', 'hasOpenaiUpstreamApiKey'],
      ['anthropic', 'hasAnthropicUpstreamApiKey'],
      ['gemini', 'hasGeminiUpstreamApiKey'],
    ] as const
  )
    .filter(([, key]) => config[key])
    .map(([format]) => `${format}: ${i18ns.t('relay.credentialConfiguredShort')}`)
    .join(', ') || '-'
const loadChannels = async (page = channelPage.page) => {
  channelsLoading.value = true
  try {
    const data = await relayChannelService.listManagementChannels({
      page,
      pageSize: channelPage.pageSize,
      channelType: 'standalone',
      submissionStatus: submissionFilter.value,
    })
    channels.value = data.items
    Object.assign(channelPage, { page: data.page, total: data.total })
  } catch (error: any) {
    ElMessage.error(error?.message || i18ns.t('relay.loadFailed'))
  } finally {
    channelsLoading.value = false
  }
}
const loadChanges = async () => {
  try {
    const data = await relayChannelService.listChangeRequests({
      page: 1,
      pageSize: 100,
      reviewStatus: 'pending',
    })
    changeRequests.value = data.items
  } catch (error: any) {
    ElMessage.error(error?.message || i18ns.t('relay.loadFailed'))
  }
}
const refresh = () => {
  void loadChannels(1)
  void loadChanges()
}
const reviewSubmission = async (id: string, action: 'approve' | 'reject' | 'offboard') => {
  try {
    await relayChannelService.reviewChannelSubmission(id, { action })
    ElMessage.success(i18ns.t('relay.reviewSuccess'))
    await loadChannels(channelPage.page)
  } catch (error: any) {
    ElMessage.error(error?.message || i18ns.t('operationFailed'))
  }
}
const reviewChange = async (id: string, action: 'approve' | 'reject') => {
  try {
    await relayChannelService.reviewChangeRequest(id, { action })
    ElMessage.success(i18ns.t('relay.reviewSuccess'))
    await loadChanges()
  } catch (error: any) {
    ElMessage.error(error?.message || i18ns.t('operationFailed'))
  }
}
const openConfig = async (id: string) => {
  try {
    configChannel.value = await relayChannelService.getChannel(id)
    configMultiplier.value = configChannel.value.multiplier
    configProviders.value = configChannel.value.providers.map((provider) => ({
      username: provider.username || '',
      commissionPercent: provider.commissionPercent,
      settlementMode: provider.settlementMode,
      settlementIntervalDays: provider.settlementIntervalDays,
      settlementTime: provider.settlementTime,
    }))
    configVisible.value = true
  } catch (error: any) {
    ElMessage.error(error?.message || i18ns.t('relay.loadFailed'))
  }
}
const saveConfig = async () => {
  if (!configChannel.value) return
  try {
    await relayChannelService.updateProviderConfig(configChannel.value.id, {
      multiplier: configMultiplier.value,
      providers: configProviders.value,
    })
    ElMessage.success(i18ns.t('relay.configurationSaved'))
    configVisible.value = false
    await loadChannels(channelPage.page)
  } catch (error: any) {
    ElMessage.error(error?.message || i18ns.t('operationFailed'))
  }
}
const showChange = (request: RelayChannelChangeRequestDto) => {
  selectedChange.value = request
  changeVisible.value = true
}
onMounted(() => {
  void loadChannels()
  void loadChanges()
})
if (!isDesktop.value) useMobileTableCardLabels('.relay-review-page')
</script>

<style scoped lang="scss">
.relay-review-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  min-width: 0;
}
.review-toolbar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 8px;
}
.surface-card {
  border: 1px solid var(--surface-card-border);
  border-radius: 8px;
  background: var(--surface-card-bg);
  box-shadow: var(--surface-card-shadow);
}
.page-heading {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
}
.page-heading h2 {
  margin: 0;
  color: var(--el-text-color-primary);
  font-size: 20px;
}
.page-heading p {
  margin: 6px 0 0;
  color: var(--el-text-color-secondary);
}
.pagination {
  justify-content: flex-end;
  margin-top: 16px;
}
.review-table {
  min-width: 0;
}
.drawer-footer {
  display: flex;
  justify-content: flex-start;
  gap: 8px;
  width: 100%;
}
.relay-review-config-drawer :deep(.el-drawer__body) {
  padding: 20px 24px;
  overflow: auto;
}
.mobile-adapter {
  padding: 8px 6px 16px;
  overflow-x: hidden;
}
@media (max-width: 768px) {
  .page-heading {
    flex-direction: column;
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
  }
  .mobile-adapter :deep(.el-table__body td) {
    display: block;
    border: none !important;
    padding: 5px 0;
  }
}
</style>
