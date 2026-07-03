<template>
  <div class="page-wrap">
    <el-card class="page-card remote-terminal-product-card">
      <template #header>
        <div class="header-row">
          <div>
            <div class="title">{{ i18ns.t('remoteTerminalProduct.pageTitle') }}</div>
            <div class="subtitle">{{ i18ns.t('remoteTerminalProduct.pageDescription') }}</div>
          </div>
          <div class="header-actions">
            <el-tag type="success" effect="plain">
              {{ i18ns.t('remoteTerminalProduct.currentBalance') }}:
              {{ formatPrice(currentBalance, '曲') }}
            </el-tag>
            <el-button :loading="loading" @click="refreshAll">{{ i18ns.t('refresh') }}</el-button>
          </div>
        </div>
      </template>

      <div v-if="!canView" class="permission-empty">
        <el-empty :description="i18ns.t('remoteTerminalProduct.noPermission')" />
      </div>

      <template v-else>
        <el-alert
          :title="i18ns.t('remoteTerminalProduct.userGuideTitle')"
          :description="i18ns.t('remoteTerminalProduct.userGuideDescription')"
          type="info"
          :closable="false"
          show-icon
        />

        <el-tabs class="section-tabs">
          <el-tab-pane :label="i18ns.t('remoteTerminalProduct.publishedPlans')">
            <el-empty
              v-if="!loading && templates.length === 0"
              :description="i18ns.t('remoteTerminalProduct.emptyPlans')"
            />
            <div v-else v-loading="loading" class="plan-grid">
              <el-card v-for="item in templates" :key="item.id" shadow="never" class="plan-card">
                <div class="card-head">
                  <div>
                    <div class="card-title">{{ item.name }}</div>
                    <div class="secondary-text card-description">{{ item.description || '-' }}</div>
                  </div>
                  <div class="card-tags">
                    <el-tag v-if="supportsDevice(item)" type="warning" size="small">
                      {{ i18ns.t('remoteTerminalProduct.deviceUnit') }}
                    </el-tag>
                    <el-tag v-if="supportsTerminal(item)" type="primary" size="small">
                      {{ i18ns.t('remoteTerminalProduct.terminalUnit') }}
                    </el-tag>
                    <el-tag
                      :type="item.publishStatus === 'published' ? 'success' : 'info'"
                      size="small"
                    >
                      {{
                        item.publishStatus === 'published'
                          ? i18ns.t('remoteTerminalProduct.published')
                          : i18ns.t('remoteTerminalProduct.draft')
                      }}
                    </el-tag>
                  </div>
                </div>
                <div class="card-grid">
                  <div class="field compact-field">
                    <span class="label">{{
                      i18ns.t('remoteTerminalProduct.deviceUnitPrice')
                    }}</span>
                    <span class="value">{{
                      formatUnitPrice(item.devicePrice, item.currency, item.billingUnit)
                    }}</span>
                  </div>
                  <div class="field compact-field">
                    <span class="label">{{
                      i18ns.t('remoteTerminalProduct.terminalUnitPrice')
                    }}</span>
                    <span class="value">{{
                      formatUnitPrice(item.terminalPrice, item.currency, item.billingUnit)
                    }}</span>
                  </div>
                  <div class="field compact-field">
                    <span class="label">{{ i18ns.t('remoteTerminalProduct.billingUnit') }}</span>
                    <span class="value">{{ formatBillingUnitLabel(item.billingUnit) }}</span>
                  </div>
                  <div class="field compact-field">
                    <span class="label">{{ i18ns.t('remoteTerminalProduct.purchaseLimit') }}</span>
                    <span class="value">{{ formatPurchaseLimit(item) }}</span>
                  </div>
                </div>

                <div class="purchase-form compact-form">
                  <div class="purchase-cell purchase-cell-row">
                    <span class="label mini-label">{{
                      i18ns.t('remoteTerminalProduct.planName')
                    }}</span>
                    <el-input
                      v-model="getPurchaseForm(item.id).entitlementName"
                      size="small"
                      :placeholder="item.name"
                      clearable
                      style="width: 160px"
                    />
                  </div>
                  <div v-if="getMergeCandidates(item).length > 0" class="purchase-cell">
                    <span class="label mini-label">{{
                      i18ns.t('remoteTerminalProduct.purchaseMode')
                    }}</span>
                    <el-radio-group
                      v-model="getPurchaseForm(item.id).purchaseMode"
                      size="small"
                      @change="handlePurchaseModeChange(item)"
                    >
                      <el-radio-button value="new">
                        {{ i18ns.t('remoteTerminalProduct.purchaseModeNew') }}
                      </el-radio-button>
                      <el-radio-button value="merge">
                        {{ i18ns.t('remoteTerminalProduct.purchaseModeMerge') }}
                      </el-radio-button>
                    </el-radio-group>
                  </div>
                  <div
                    v-if="getPurchaseForm(item.id).purchaseMode === 'merge'"
                    class="purchase-cell"
                  >
                    <span class="label mini-label">{{
                      i18ns.t('remoteTerminalProduct.mergeTarget')
                    }}</span>
                    <el-select
                      v-model="getPurchaseForm(item.id).targetEntitlementId"
                      size="small"
                      class="compact-select"
                      @change="handleMergeTargetChange(item)"
                      :placeholder="i18ns.t('remoteTerminalProduct.mergeTargetPlaceholder')"
                    >
                      <el-option
                        v-for="entitlement in getMergeCandidates(item)"
                        :key="entitlement.id"
                        :label="formatEntitlementOptionLabel(entitlement)"
                        :value="entitlement.id"
                      />
                    </el-select>
                  </div>
                  <div
                    v-if="getPurchaseForm(item.id).purchaseMode === 'merge'"
                    class="purchase-cell purchase-cell-hint"
                  >
                    <span class="secondary-text mini-helper">
                      {{ i18ns.t('remoteTerminalProduct.mergeQuotaHint') }}
                    </span>
                  </div>
                  <div class="purchase-cell purchase-cell-row">
                    <span class="label mini-label">{{
                      i18ns.t('remoteTerminalProduct.purchaseUnits')
                    }}</span>
                    <el-input-number
                      v-model="getPurchaseForm(item.id).purchaseUnits"
                      :min="
                        getPurchaseForm(item.id).purchaseMode === 'merge'
                          ? 0
                          : item.minimumPurchaseUnits || 1
                      "
                      :max="item.maximumPurchaseUnits ?? undefined"
                      :step="1"
                      size="small"
                      class="compact-input"
                    />
                  </div>
                  <div class="purchase-cell purchase-cell-hint">
                    <span class="secondary-text mini-helper">
                      {{
                        i18ns.t('remoteTerminalProduct.minimumPurchaseHint', {
                          count: item.minimumPurchaseUnits,
                          unit: formatBillingUnitLabel(item.billingUnit),
                        })
                      }}
                    </span>
                  </div>
                  <div class="purchase-cell purchase-cell-row">
                    <span class="label mini-label">{{
                      i18ns.t('remoteTerminalProduct.deviceCount')
                    }}</span>
                    <el-input-number
                      v-model="getPurchaseForm(item.id).deviceCount"
                      :min="getMinimumDeviceCount(item)"
                      :max="item.maxDeviceCount ?? undefined"
                      :step="1"
                      :disabled="!supportsDevice(item)"
                      @change="handlePurchaseCountChange(item, 'device')"
                      size="small"
                      class="compact-input"
                    />
                  </div>
                  <div class="purchase-cell purchase-cell-row">
                    <span class="label mini-label">{{
                      i18ns.t('remoteTerminalProduct.terminalCount')
                    }}</span>
                    <el-input-number
                      v-model="getPurchaseForm(item.id).terminalCount"
                      :min="getMinimumTerminalCount(item)"
                      :max="item.maxTerminalCount ?? undefined"
                      :step="1"
                      :disabled="!supportsTerminal(item)"
                      @change="handlePurchaseCountChange(item, 'terminal')"
                      size="small"
                      class="compact-input"
                    />
                  </div>
                </div>

                <div class="plan-actions compact-actions">
                  <div class="total-box">
                    <span class="label mini-label">{{
                      i18ns.t('remoteTerminalProduct.estimatedPrice')
                    }}</span>
                    <span class="value total-value">{{
                      formatPrice(getEstimatedPrice(item), item.currency)
                    }}</span>
                    <div
                      v-for="line in getPriceBreakdown(item)"
                      :key="line"
                      class="price-breakdown-line"
                    >
                      {{ line }}
                    </div>
                  </div>
                  <el-tooltip
                    :disabled="!getClaimState(item).disabledReason"
                    :content="getClaimState(item).disabledReason || ''"
                    placement="top"
                  >
                    <el-button
                      type="primary"
                      size="small"
                      :loading="claimingTemplateId === item.id"
                      :disabled="Boolean(getClaimState(item).disabledReason)"
                      @click="handleClaimTemplate(item)"
                    >
                      {{
                        getEstimatedPrice(item) === 0 &&
                        getPurchaseForm(item.id).purchaseMode !== 'merge'
                          ? i18ns.t('remoteTerminalProduct.claimFreePlan')
                          : i18ns.t('remoteTerminalProduct.claimPlan')
                      }}
                    </el-button>
                  </el-tooltip>
                </div>
              </el-card>
            </div>
          </el-tab-pane>

          <el-tab-pane :label="i18ns.t('remoteTerminalProduct.myEntitlements')">
            <el-empty
              v-if="!loading && entitlements.length === 0"
              :description="i18ns.t('remoteTerminalProduct.emptyEntitlements')"
            />
            <el-table v-else :data="entitlements" v-loading="loading" stripe>
              <el-table-column
                prop="name"
                :label="i18ns.t('remoteTerminalProduct.planName')"
                min-width="80"
              />
              <el-table-column
                prop="templateName"
                :label="i18ns.t('remoteTerminalProduct.templatesTab')"
                min-width="80"
              />
              <el-table-column
                :label="i18ns.t('remoteTerminalProduct.validPeriod')"
                min-width="120"
              >
                <template #default="{ row }">
                  <div>{{ formatDateTime(row.startAt) }}</div>
                  <div class="secondary-text">{{ formatDateTime(row.endAt) }}</div>
                </template>
              </el-table-column>
              <el-table-column :label="i18ns.t('remoteTerminalProduct.durationDays')" width="120">
                <template #default="{ row }">{{ row.durationDays }}</template>
              </el-table-column>
              <el-table-column :label="i18ns.t('remoteTerminalProduct.deviceLimit')" width="100">
                <template #default="{ row }"
                  >{{ row.registeredDeviceCount }} / {{ row.deviceLimit }}</template
                >
              </el-table-column>
              <el-table-column
                prop="terminalLimit"
                :label="i18ns.t('remoteTerminalProduct.terminalLimit')"
                width="180"
              >
              </el-table-column>
              <el-table-column
                :label="i18ns.t('remoteTerminalProduct.registrationToken')"
                min-width="120"
              >
                <template #default="{ row }">
                  <div class="token-stack">
                    <span>{{
                      row.registrationToken?.maskedToken || i18ns.t('remoteTerminalProduct.noToken')
                    }}</span>
                    <span v-if="!hasDeviceQuota(row.deviceLimit)" class="secondary-text">
                      {{ i18ns.t('remoteTerminalProduct.tokenUnavailableForTerminalOnly') }}
                    </span>
                  </div>
                </template>
              </el-table-column>
              <el-table-column :label="i18ns.t('status')" width="100">
                <template #default="{ row }">
                  <el-tag :type="statusTagType(entitlementStatus(row))" size="small">
                    {{ i18ns.t(statusTextKey(entitlementStatus(row))) }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column :label="i18ns.t('actions')" min-width="240" fixed="right">
                <template #default="{ row }">
                  <div class="token-actions">
                    <el-button
                      v-if="row.registrationToken?.token"
                      link
                      type="primary"
                      @click="copyToken(row.registrationToken.token)"
                    >
                      {{ i18ns.t('remoteTerminalProduct.copyToken') }}
                    </el-button>
                    <el-button
                      v-if="hasDeviceQuota(row.deviceLimit)"
                      link
                      type="warning"
                      :loading="rotatingEntitlementId === row.id"
                      @click="handleRotateMyToken(row)"
                    >
                      {{ i18ns.t('remoteTerminalProduct.rotateToken') }}
                    </el-button>
                    <el-button link type="primary" @click="goConsole()">
                      {{ i18ns.t('remoteTerminalProduct.connectDevice') }}
                    </el-button>
                    <el-button link type="success" @click="openInstallDialog(row)">
                      {{ i18ns.t('remoteTerminalProduct.installAgent') }}
                    </el-button>
                  </div>
                </template>
              </el-table-column>
            </el-table>
          </el-tab-pane>

          <el-tab-pane :label="i18ns.t('remoteTerminalProduct.myDevices')">
            <el-empty
              v-if="!loading && devices.length === 0"
              :description="i18ns.t('remoteTerminalProduct.emptyDevices')"
            />
            <el-table v-else :data="devices" v-loading="loading" stripe>
              <el-table-column
                prop="hostname"
                :label="i18ns.t('remoteTerminalProduct.hostname')"
                min-width="160"
              />
              <el-table-column
                prop="deviceId"
                :label="i18ns.t('remoteTerminal.deviceId')"
                min-width="160"
              />
              <el-table-column
                prop="entitlementName"
                :label="i18ns.t('remoteTerminalProduct.entitlementsTab')"
                min-width="160"
              />
              <el-table-column :label="i18ns.t('remoteTerminalProduct.platform')" width="120">
                <template #default="{ row }">{{ row.platform }}</template>
              </el-table-column>
              <el-table-column :label="i18ns.t('remoteTerminalProduct.lastSeenAt')" min-width="160">
                <template #default="{ row }">{{ formatDateTime(row.lastSeenAt) }}</template>
              </el-table-column>
              <el-table-column :label="i18ns.t('actions')" width="180" fixed="right">
                <template #default="{ row }">
                  <el-button link type="primary" @click="goConsole()">
                    {{ i18ns.t('remoteTerminalProduct.connectDevice') }}
                  </el-button>
                  <el-button
                    link
                    type="danger"
                    :loading="revokingDeviceId === row.id"
                    @click="handleRevokeMyDevice(row.id)"
                  >
                    {{ i18ns.t('remoteTerminalProduct.revokeDevice') }}
                  </el-button>
                </template>
              </el-table-column>
            </el-table>
          </el-tab-pane>
        </el-tabs>
      </template>
    </el-card>
  </div>
  <el-dialog
    v-model="unbindDialogVisible"
    :title="i18ns.t('remoteTerminalProduct.revokeDeviceDialogTitle')"
    width="520px"
    destroy-on-close
  >
    <div class="unbind-dialog" v-loading="unbindReminderLoading">
      <template v-if="unbindReminder">
        <div class="unbind-dialog__warning">
          {{ i18ns.t('remoteTerminalProduct.revokeDeviceDialogWarning') }}
        </div>
        <div class="unbind-dialog__line">
          {{
            i18ns.t('remoteTerminalProduct.revokeDeviceAllowance', {
              windowHours: unbindReminder.windowHours,
              remainingCount: unbindReminder.remainingCount,
            })
          }}
        </div>
        <div class="unbind-dialog__line">
          {{
            i18ns.t('remoteTerminalProduct.revokeDeviceAfterAction', {
              remainingCount: Math.max(0, unbindReminder.remainingCount - 1),
            })
          }}
        </div>
        <div class="unbind-dialog__line">
          {{
            i18ns.t('remoteTerminalProduct.revokeDeviceCooldown', {
              minutes: unbindReminder.rebindCooldownMinutes,
            })
          }}
        </div>
        <div class="unbind-dialog__line secondary-text">
          {{
            i18ns.t('remoteTerminalProduct.revokeDeviceUsedCount', {
              revokedCount: unbindReminder.revokedCount,
              maxCount: unbindReminder.maxCount,
            })
          }}
        </div>
        <el-checkbox v-model="unbindAgreementChecked">
          {{ i18ns.t('remoteTerminalProduct.revokeDeviceAgreement') }}
        </el-checkbox>
      </template>
    </div>
    <template #footer>
      <el-button @click="closeUnbindDialog">{{ i18ns.t('cancel') }}</el-button>
      <el-button
        type="danger"
        :disabled="!unbindAgreementChecked || !unbindReminder"
        :loading="Boolean(revokingDeviceId)"
        @click="confirmRevokeMyDevice"
      >
        {{ i18ns.t('remoteTerminalProduct.revokeDeviceConfirmAction') }}
      </el-button>
    </template>
  </el-dialog>
  <!-- Install Agent Dialog -->
  <el-dialog
    v-model="installDialogVisible"
    :title="i18ns.t('remoteTerminalProduct.installAgentTitle')"
    width="46vw"
  >
    <el-form label-position="top">
      <el-form-item :label="i18ns.t('remoteTerminalProduct.installOs')">
        <el-radio-group v-model="installOs">
          <el-radio value="linux">Linux</el-radio>
          <el-radio value="windows">Windows</el-radio>
          <el-radio value="macos">macOS</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item :label="i18ns.t('remoteTerminalProduct.installArch')">
        <el-radio-group v-model="installArch">
          <el-radio value="x64">x64</el-radio>
          <el-radio value="arm64">arm64</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item :label="i18ns.t('remoteTerminalProduct.installVersion')">
        <el-select
          v-model="installVersion"
          filterable
          allow-create
          :placeholder="i18ns.t('remoteTerminalProduct.installVersionPlaceholder')"
          :loading="installVersionLoading"
          style="width: 100%"
        >
          <el-option v-for="v in installVersionOptions" :key="v" :label="v" :value="v" />
        </el-select>
        <div
          v-if="installVersionError"
          style="color: var(--el-color-danger); font-size: 12px; margin-top: 4px"
        >
          {{ i18ns.t('remoteTerminalProduct.installVersionFetchFailed') }}
          <el-button link size="small" @click="fetchInstallVersion">{{
            i18ns.t('refresh')
          }}</el-button>
        </div>
      </el-form-item>
      <el-form-item :label="i18ns.t('remoteTerminalProduct.installProxy')">
        <el-input
          v-model="installProxy"
          :placeholder="i18ns.t('remoteTerminalProduct.installProxyPlaceholder')"
          clearable
          style="width: 100%"
        />
      </el-form-item>
      <el-form-item>
        <div style="display: flex; gap: 16px">
          <el-switch
            v-model="installShowProgress"
            :active-text="i18ns.t('remoteTerminalProduct.installShowProgress')"
          />
          <el-switch
            v-model="installRunBackground"
            :active-text="i18ns.t('remoteTerminalProduct.installRunBackground')"
          />
          <el-switch
            v-model="installUseStaticToken"
            :active-text="i18ns.t('remoteTerminalProduct.installUseStaticToken')"
            @change="onInstallUseStaticTokenChange"
          />
        </div>
      </el-form-item>
      <div v-loading="installVersionLoading" style="min-height: 60px">
        <div v-for="cmd in installCommands" :key="cmd.label" style="margin-bottom: 12px">
          <div style="font-size: 12px; color: var(--el-text-color-secondary); margin-bottom: 4px">
            {{ cmd.label }}
          </div>
          <div style="display: flex; gap: 8px; align-items: flex-start">
            <el-input
              type="textarea"
              :value="cmd.command"
              readonly
              :rows="cmd.command.split('\n').length + 2"
              style="flex: 1; font-family: monospace; font-size: 12px"
            />
            <el-button size="small" @click="copyCommand(cmd.command)">{{
              i18ns.t('copy')
            }}</el-button>
          </div>
        </div>
      </div>
    </el-form>
    <template #footer>
      <el-button @click="installDialogVisible = false">{{ i18ns.t('close') }}</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useRouter } from 'vue-router'
import { i18ns } from '@/locales'
import { copyToClipboard } from '@/utils/common'
import { MANAGED_STATUS } from '@/constant/status'
import { remoteTerminalProductService } from '@/service/remoteTerminalProductService'
import { remoteTerminalService } from '@/service/remoteTerminalService'
import { permissionService } from '@/service/permissionService'
import { balanceService } from '@/service/balanceService'
import { usePermissionStore } from '@/stores/permissionStore'
import type {
  RemoteTerminalBillingUnit,
  RemoteTerminalBoundDeviceDto,
  RemoteTerminalProductTemplateDto,
  RemoteTerminalSessionSummaryDto,
  RemoteTerminalUnbindReminderDto,
  RemoteTerminalUserEntitlementDto,
  RemoteTerminalPlatform,
} from '@/client/types.gen'

type EntitlementStatus = 'active' | 'pending' | 'expired' | 'disabled'
type PurchaseMode = 'new' | 'merge'

interface PurchaseFormState {
  purchaseMode: PurchaseMode
  targetEntitlementId?: string
  entitlementName: string
  purchaseUnits: number
  deviceCount: number
  terminalCount: number
}

const router = useRouter()
const permissionStore = usePermissionStore()

const loading = ref(false)
const claimingTemplateId = ref<string>()
const rotatingEntitlementId = ref<string>()
const revokingDeviceId = ref<string>()
const currentBalance = ref(0)
const templates = ref<RemoteTerminalProductTemplateDto[]>([])
const entitlements = ref<RemoteTerminalUserEntitlementDto[]>([])
const devices = ref<RemoteTerminalBoundDeviceDto[]>([])
const sessions = ref<RemoteTerminalSessionSummaryDto[]>([])
const purchaseForms = reactive<Record<string, PurchaseFormState>>({})
const unbindDialogVisible = ref(false)
const unbindReminderLoading = ref(false)
const unbindAgreementChecked = ref(false)
const unbindTargetDeviceId = ref<string>()
const unbindReminder = ref<RemoteTerminalUnbindReminderDto>()

const createDefaultPurchaseForm = (): PurchaseFormState => ({
  purchaseMode: 'new',
  targetEntitlementId: undefined,
  entitlementName: '',
  purchaseUnits: 1,
  deviceCount: 0,
  terminalCount: 0,
})

const toErrorMessage = (error: unknown, fallback: string) => {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }
  return fallback
}

const canView = computed(() => Boolean(permissionStore))

const supportsDevice = (item: { devicePrice?: number }) => item.devicePrice != null
const supportsTerminal = (item: { terminalPrice?: number }) => item.terminalPrice != null

// Reactive clock — ticks every minute so pricing auto-updates
const nowMs = ref(Date.now())
const _clockTimer = setInterval(() => {
  nowMs.value = Date.now()
}, 1_000)
onUnmounted(() => clearInterval(_clockTimer))

const getBillingUnitDays = (billingUnit?: RemoteTerminalBillingUnit) => {
  if (billingUnit === 'week') return 7
  if (billingUnit === 'month') return 30
  return 1
}

const formatBillingUnitLabel = (billingUnit?: RemoteTerminalBillingUnit) => {
  if (billingUnit === 'week') return i18ns.t('remoteTerminalProduct.billingUnitWeek')
  if (billingUnit === 'month') return i18ns.t('remoteTerminalProduct.billingUnitMonth')
  return i18ns.t('remoteTerminalProduct.billingUnitDay')
}

const formatUnitPrice = (
  price?: number,
  currency?: string,
  billingUnit?: RemoteTerminalBillingUnit,
) => {
  if (price == null) return '-'
  return `${formatPrice(price, currency)} / ${formatBillingUnitLabel(billingUnit)}`
}

const clampNonNegativeInteger = (value: number | null | undefined) => {
  const normalized = Number(value || 0)
  if (!Number.isFinite(normalized) || normalized <= 0) return 0
  return Math.floor(normalized)
}

const getConfiguredMinimumDeviceCount = (item: RemoteTerminalProductTemplateDto) =>
  supportsDevice(item) ? Number(item.minimumDeviceCount || 0) : 0

const getConfiguredMinimumTerminalCount = (item: RemoteTerminalProductTemplateDto) =>
  supportsTerminal(item) ? Number(item.minimumTerminalCount || 0) : 0

const getConfiguredMaximumDeviceCount = (item: RemoteTerminalProductTemplateDto) =>
  supportsDevice(item) && item.maxDeviceCount != null ? Number(item.maxDeviceCount) : undefined

const getConfiguredMaximumTerminalCount = (item: RemoteTerminalProductTemplateDto) =>
  supportsTerminal(item) && item.maxTerminalCount != null
    ? Number(item.maxTerminalCount)
    : undefined

const normalizePurchaseFormForTemplate = (
  item: RemoteTerminalProductTemplateDto,
  form: PurchaseFormState,
  preferredUnit: 'device' | 'terminal' = 'device',
): PurchaseFormState => {
  const deviceSupported = supportsDevice(item)
  const terminalSupported = supportsTerminal(item)
  const mergeCandidates = getMergeCandidates(item)
  const purchaseMode: PurchaseMode =
    form.purchaseMode === 'merge' && mergeCandidates.length > 0 ? 'merge' : 'new'
  const targetEntitlementId =
    purchaseMode === 'merge'
      ? mergeCandidates.some((candidate) => candidate.id === form.targetEntitlementId)
        ? form.targetEntitlementId
        : mergeCandidates[0]?.id
      : undefined
  const configuredMinDeviceCount = getConfiguredMinimumDeviceCount(item)
  const configuredMinTerminalCount = getConfiguredMinimumTerminalCount(item)
  const configuredMaxPurchaseUnits =
    item.maximumPurchaseUnits != null ? Number(item.maximumPurchaseUnits) : undefined
  const configuredMaxDeviceCount = getConfiguredMaximumDeviceCount(item)
  const configuredMaxTerminalCount = getConfiguredMaximumTerminalCount(item)

  const nextForm: PurchaseFormState = {
    purchaseMode,
    targetEntitlementId,
    purchaseUnits:
      purchaseMode === 'merge'
        ? Math.max(0, Math.floor(Number(form.purchaseUnits) || 0))
        : Math.max(
            Number(item.minimumPurchaseUnits || 1),
            Math.floor(Number(form.purchaseUnits || item.minimumPurchaseUnits || 1) || 1),
          ),
    deviceCount: deviceSupported ? clampNonNegativeInteger(form.deviceCount) : 0,
    terminalCount: terminalSupported ? clampNonNegativeInteger(form.terminalCount) : 0,
    entitlementName: form.entitlementName,
  }

  if (configuredMaxPurchaseUnits != null) {
    nextForm.purchaseUnits = Math.min(nextForm.purchaseUnits, configuredMaxPurchaseUnits)
  }

  if (purchaseMode !== 'merge') {
    nextForm.deviceCount = deviceSupported
      ? Math.max(nextForm.deviceCount, configuredMinDeviceCount)
      : 0
    nextForm.terminalCount = terminalSupported
      ? Math.max(nextForm.terminalCount, configuredMinTerminalCount)
      : 0
  }

  if (configuredMaxDeviceCount != null) {
    nextForm.deviceCount = Math.min(nextForm.deviceCount, configuredMaxDeviceCount)
  }

  if (configuredMaxTerminalCount != null) {
    nextForm.terminalCount = Math.min(nextForm.terminalCount, configuredMaxTerminalCount)
  }

  const mergeTarget =
    purchaseMode === 'merge'
      ? mergeCandidates.find((candidate) => candidate.id === targetEntitlementId)
      : undefined

  if (mergeTarget) {
    nextForm.deviceCount = deviceSupported
      ? Math.max(nextForm.deviceCount, Number(mergeTarget.deviceLimit || 0))
      : 0
    nextForm.terminalCount = terminalSupported
      ? Math.max(nextForm.terminalCount, Number(mergeTarget.terminalLimit || 0))
      : 0
  }

  if (nextForm.deviceCount > 0 || nextForm.terminalCount > 0) {
    return nextForm
  }

  if (preferredUnit === 'terminal' && terminalSupported) {
    nextForm.terminalCount = 1
    return nextForm
  }

  if (deviceSupported) {
    nextForm.deviceCount = 1
    return nextForm
  }

  if (terminalSupported) {
    nextForm.terminalCount = 1
  }

  return nextForm
}

const applyNormalizedPurchaseForm = (
  item: RemoteTerminalProductTemplateDto,
  preferredUnit: 'device' | 'terminal' = 'device',
) => {
  const normalizedForm = normalizePurchaseFormForTemplate(
    item,
    ensurePurchaseForm(item.id),
    preferredUnit,
  )
  purchaseForms[item.id] = normalizedForm
  return normalizedForm
}

const ensurePurchaseForm = (id: string): PurchaseFormState => {
  if (!purchaseForms[id]) {
    purchaseForms[id] = createDefaultPurchaseForm()
  }

  return purchaseForms[id]
}

const getPurchaseForm = (id: string): PurchaseFormState =>
  purchaseForms[id] ?? createDefaultPurchaseForm()

const getNormalizedPurchaseForm = (
  item: RemoteTerminalProductTemplateDto,
  preferredUnit: 'device' | 'terminal' = 'device',
) => normalizePurchaseFormForTemplate(item, getPurchaseForm(item.id), preferredUnit)

const syncPurchaseForms = (list: RemoteTerminalProductTemplateDto[]) => {
  const activeIds = new Set(list.map((item) => item.id))

  Object.keys(purchaseForms).forEach((id) => {
    if (!activeIds.has(id)) {
      delete purchaseForms[id]
    }
  })

  list.forEach((item) => {
    ensurePurchaseForm(item.id)
    applyNormalizedPurchaseForm(item)
  })
}

const formatDateTime = (value?: string) => {
  if (!value) return '-'
  const time = new Date(value)
  if (Number.isNaN(time.getTime())) return value
  return time.toLocaleString()
}

const formatPrice = (price?: number, currency?: string) => {
  if (price == null) return '-'
  return `${Number(price)
    .toFixed(4)
    .replace(/\.?0+$/, '')} ${currency || '曲'}`
}

const formatPurchaseLimit = (item: RemoteTerminalProductTemplateDto) => {
  if (!item.purchaseLimitPerUser || !item.purchaseLimitWindowDays) {
    return i18ns.t('remoteTerminalProduct.unlimitedPurchase')
  }

  return i18ns.t('remoteTerminalProduct.purchaseLimitValue', {
    count: item.purchaseLimitPerUser,
    days: item.purchaseLimitWindowDays,
  })
}

const hasDeviceQuota = (deviceLimit?: number) => Number(deviceLimit || 0) > 0

const formatEntitlementOptionLabel = (row: RemoteTerminalUserEntitlementDto) => {
  const statusLabel = i18ns.t(statusTextKey(entitlementStatus(row)))
  return `${row.name} · ${statusLabel} · ${row.deviceLimit}${i18ns.t('remoteTerminalProduct.deviceUnit')}/${row.terminalLimit}${i18ns.t('remoteTerminalProduct.terminalUnit')} · ${formatDateTime(row.endAt)}`
}

const getMergeCandidates = (item: RemoteTerminalProductTemplateDto) =>
  entitlements.value
    .filter(
      (entitlement) =>
        entitlement.templateId === item.id && entitlement.status !== MANAGED_STATUS.DELETED,
    )
    .sort((left, right) => {
      const leftStatus = entitlementStatus(left)
      const rightStatus = entitlementStatus(right)
      const statusRank: Record<EntitlementStatus, number> = {
        active: 0,
        pending: 1,
        expired: 2,
        disabled: 3,
      }

      if (statusRank[leftStatus] !== statusRank[rightStatus]) {
        return statusRank[leftStatus] - statusRank[rightStatus]
      }

      return new Date(right.endAt).getTime() - new Date(left.endAt).getTime()
    })

const getSelectedMergeTarget = (
  item: RemoteTerminalProductTemplateDto,
  form: PurchaseFormState = getNormalizedPurchaseForm(item),
) => {
  const targetId = form.targetEntitlementId
  return getMergeCandidates(item).find((entitlement) => entitlement.id === targetId)
}

const entitlementStatus = (row: RemoteTerminalUserEntitlementDto): EntitlementStatus => {
  if (row.status !== MANAGED_STATUS.ENABLED) return 'disabled'
  const now = nowMs.value
  const startAt = new Date(row.startAt).getTime()
  const endAt = new Date(row.endAt).getTime()

  if (Number.isNaN(startAt) || Number.isNaN(endAt)) return 'disabled'
  if (now < startAt) return 'pending'
  if (now > endAt) return 'expired'
  return 'active'
}

const statusTextKey = (status: EntitlementStatus) => {
  if (status === 'active') return 'remoteTerminalProduct.active'
  if (status === 'pending') return 'remoteTerminalProduct.pending'
  if (status === 'expired') return 'remoteTerminalProduct.expired'
  return 'remoteTerminalProduct.disabled'
}

const statusTagType = (status: EntitlementStatus) => {
  if (status === 'active') return 'success'
  if (status === 'pending') return 'warning'
  if (status === 'expired') return 'info'
  return 'danger'
}

const isTemplateClaimedInWindow = (item: RemoteTerminalProductTemplateDto) => {
  if (!item.purchaseLimitPerUser || !item.purchaseLimitWindowDays) return false

  const windowStart = new Date()
  windowStart.setDate(windowStart.getDate() - item.purchaseLimitWindowDays)
  const windowStartTime = windowStart.getTime()

  const claimedCount = entitlements.value.filter((entitlement) => {
    if (entitlement.templateId !== item.id) return false
    const createdAt = new Date(entitlement.createTime).getTime()
    return !Number.isNaN(createdAt) && createdAt >= windowStartTime
  }).length

  return claimedCount >= item.purchaseLimitPerUser
}

const getMinimumDeviceCount = (item: RemoteTerminalProductTemplateDto) => {
  const form = getNormalizedPurchaseForm(item)
  if (form.purchaseMode === 'merge') {
    return Number(getSelectedMergeTarget(item, form)?.deviceLimit || 0)
  }
  return getConfiguredMinimumDeviceCount(item)
}

const getMinimumTerminalCount = (item: RemoteTerminalProductTemplateDto) => {
  const form = getNormalizedPurchaseForm(item)
  if (form.purchaseMode === 'merge') {
    return Number(getSelectedMergeTarget(item, form)?.terminalLimit || 0)
  }
  return getConfiguredMinimumTerminalCount(item)
}

const getEstimatedPrice = (item: RemoteTerminalProductTemplateDto) => {
  const _now = nowMs.value // reactive dependency — triggers re-render on clock tick
  const form = getNormalizedPurchaseForm(item)
  const mergeTarget = form.purchaseMode === 'merge' ? getSelectedMergeTarget(item, form) : undefined
  const billingUnitDays = getBillingUnitDays(item.billingUnit)

  if (mergeTarget) {
    const newDeviceCount = Number(form.deviceCount || 0)
    const newTerminalCount = Number(form.terminalCount || 0)
    const units = Number(form.purchaseUnits || 0)

    // Renewal cost: purchaseUnits × unitPrice × new (post-merge) quota; 0 when upgrade-only
    const renewalAmount =
      units *
      ((supportsDevice(item) ? Number(item.devicePrice || 0) * newDeviceCount : 0) +
        (supportsTerminal(item) ? Number(item.terminalPrice || 0) * newTerminalCount : 0))

    const additionalDeviceCount = Math.max(0, newDeviceCount - Number(mergeTarget.deviceLimit || 0))
    const additionalTerminalCount = Math.max(
      0,
      newTerminalCount - Number(mergeTarget.terminalLimit || 0),
    )

    if (additionalDeviceCount <= 0 && additionalTerminalCount <= 0) {
      return Math.ceil(renewalAmount)
    }

    // Upgrade cost: ceil-integer hours
    const remainingHours = Math.ceil(
      Math.max(0, new Date(mergeTarget.endAt).getTime() - nowMs.value) / (60 * 60 * 1000),
    )
    const upgradeAmount =
      (remainingHours / (billingUnitDays * 24)) *
      ((supportsDevice(item) ? Number(item.devicePrice || 0) * additionalDeviceCount : 0) +
        (supportsTerminal(item) ? Number(item.terminalPrice || 0) * additionalTerminalCount : 0))

    return Math.ceil(renewalAmount + upgradeAmount)
  }

  const devicePrice = supportsDevice(item)
    ? Number(item.devicePrice || 0) * Number(form.deviceCount || 0)
    : 0
  const terminalPrice = supportsTerminal(item)
    ? Number(item.terminalPrice || 0) * Number(form.terminalCount || 0)
    : 0

  return Number(form.purchaseUnits || 0) * (devicePrice + terminalPrice)
}

const getPriceBreakdown = (item: RemoteTerminalProductTemplateDto): string[] => {
  const _now = nowMs.value // reactive dependency
  const form = getNormalizedPurchaseForm(item)
  const mergeTarget = form.purchaseMode === 'merge' ? getSelectedMergeTarget(item, form) : undefined
  const billingUnitDays = getBillingUnitDays(item.billingUnit)
  const unit = formatBillingUnitLabel(item.billingUnit)
  const cur = item.currency
  const fp = (n: number) => formatPrice(n, cur)
  const units = Number(form.purchaseUnits || 0)

  if (mergeTarget) {
    const newD = Number(form.deviceCount || 0)
    const newT = Number(form.terminalCount || 0)
    const oldD = Number(mergeTarget.deviceLimit || 0)
    const oldT = Number(mergeTarget.terminalLimit || 0)
    const addD = Math.max(0, newD - oldD)
    const addT = Math.max(0, newT - oldT)
    const dPrice = Number(item.devicePrice || 0)
    const tPrice = Number(item.terminalPrice || 0)

    const renewalTotal =
      units *
      ((supportsDevice(item) ? dPrice * newD : 0) + (supportsTerminal(item) ? tPrice * newT : 0))
    const t18 = (k: string, p?: Record<string, any>) =>
      i18ns.t(`remoteTerminalProduct.${k}` as any, p)
    const lines: string[] = []
    if (units > 0) {
      lines.push(t18('breakdownRenewal'))
      if (supportsDevice(item))
        lines.push(
          t18('breakdownDevice', {
            units,
            unit,
            count: newD,
            price: fp(dPrice),
            total: fp(units * newD * dPrice),
          }),
        )
      if (supportsTerminal(item))
        lines.push(
          t18('breakdownTerminal', {
            units,
            unit,
            count: newT,
            price: fp(tPrice),
            total: fp(units * newT * tPrice),
          }),
        )
      lines.push(t18('breakdownSubtotal', { total: fp(renewalTotal) }))
    } else {
      lines.push(t18('breakdownRenewalOnly'))
    }

    if (addD > 0 || addT > 0) {
      const remainingHours = Math.ceil(
        Math.max(0, new Date(mergeTarget.endAt).getTime() - nowMs.value) / (60 * 60 * 1000),
      )
      const upgradeRatio = remainingHours / (billingUnitDays * 24)
      const rh = String(remainingHours)
      const unitHours = billingUnitDays * 24
      lines.push(t18('breakdownUpgrade'))
      lines.push(t18('breakdownOldQuota', { device: oldD, terminal: oldT }))
      lines.push(t18('breakdownNewQuota', { device: newD, terminal: newT }))
      lines.push(t18('breakdownRemainingDays', { days: rh, unit, unitDays: unitHours }))
      if (addD > 0)
        lines.push(
          t18('breakdownDeviceUpgrade', {
            days: rh,
            unitDays: unitHours,
            count: addD,
            price: fp(dPrice),
            unit,
            total: fp(upgradeRatio * addD * dPrice),
          }),
        )
      if (addT > 0)
        lines.push(
          t18('breakdownTerminalUpgrade', {
            days: rh,
            unitDays: unitHours,
            count: addT,
            price: fp(tPrice),
            unit,
            total: fp(upgradeRatio * addT * tPrice),
          }),
        )
      const upgradeTotal =
        upgradeRatio *
        ((supportsDevice(item) ? dPrice * addD : 0) + (supportsTerminal(item) ? tPrice * addT : 0))
      lines.push(t18('breakdownSubtotal', { total: fp(upgradeTotal) }))
      lines.push(t18('breakdownTotal', { total: fp(renewalTotal + upgradeTotal) }))
    } else {
      lines.push(t18('breakdownTotal', { total: fp(renewalTotal) }))
    }
    return lines
  }

  // New purchase
  const d = Number(form.deviceCount || 0)
  const t = Number(form.terminalCount || 0)
  const dPrice = Number(item.devicePrice || 0)
  const tPrice = Number(item.terminalPrice || 0)
  const t18 = (k: string, p?: Record<string, any>) =>
    i18ns.t(`remoteTerminalProduct.${k}` as any, p)
  const lines: string[] = []
  if (supportsDevice(item) && d > 0)
    lines.push(
      t18('breakdownNewDevice', {
        units,
        unit,
        count: d,
        price: fp(dPrice),
        total: fp(units * d * dPrice),
      }),
    )
  if (supportsTerminal(item) && t > 0)
    lines.push(
      t18('breakdownNewTerminal', {
        units,
        unit,
        count: t,
        price: fp(tPrice),
        total: fp(units * t * tPrice),
      }),
    )
  const total =
    units * ((supportsDevice(item) ? dPrice * d : 0) + (supportsTerminal(item) ? tPrice * t : 0))
  if (lines.length > 1) lines.push(t18('breakdownTotal', { total: fp(total) }))
  return lines
}

const getClaimState = (item: RemoteTerminalProductTemplateDto) => {
  const rawForm = ensurePurchaseForm(item.id)
  const form = getNormalizedPurchaseForm(item)

  if (item.publishStatus !== 'published') {
    return { disabledReason: i18ns.t('remoteTerminalProduct.planUnavailable') }
  }

  if (
    form.purchaseMode !== 'merge' &&
    Number(rawForm.purchaseUnits || 0) < Number(item.minimumPurchaseUnits || 1)
  ) {
    return {
      disabledReason: i18ns.t('remoteTerminalProduct.minimumPurchaseUnitsRequired', {
        count: item.minimumPurchaseUnits,
        unit: formatBillingUnitLabel(item.billingUnit),
      }),
    }
  }

  if (
    item.maximumPurchaseUnits != null &&
    Number(form.purchaseUnits || 0) > Number(item.maximumPurchaseUnits)
  ) {
    return {
      disabledReason: i18ns.t('remoteTerminalProduct.maximumPurchaseUnitsExceeded', {
        count: item.maximumPurchaseUnits,
        unit: formatBillingUnitLabel(item.billingUnit),
      }),
    }
  }

  if (claimingTemplateId.value === item.id) {
    return { disabledReason: i18ns.t('remoteTerminalProduct.claimInProgress') }
  }

  if (form.purchaseMode === 'new' && isTemplateClaimedInWindow(item)) {
    return { disabledReason: i18ns.t('remoteTerminalProduct.purchaseLimitReached') }
  }

  if (form.purchaseMode === 'merge' && !getSelectedMergeTarget(item, form)) {
    return { disabledReason: i18ns.t('remoteTerminalProduct.mergeSelectionRequired') }
  }

  const mergeTarget = form.purchaseMode === 'merge' ? getSelectedMergeTarget(item, form) : undefined

  if (mergeTarget && Number(form.deviceCount || 0) < Number(mergeTarget.deviceLimit || 0)) {
    return { disabledReason: i18ns.t('remoteTerminalProduct.mergeDeviceCountTooLow') }
  }

  if (mergeTarget && Number(form.terminalCount || 0) < Number(mergeTarget.terminalLimit || 0)) {
    return { disabledReason: i18ns.t('remoteTerminalProduct.mergeTerminalCountTooLow') }
  }

  if (
    form.purchaseMode !== 'merge' &&
    Number(form.deviceCount || 0) < getConfiguredMinimumDeviceCount(item)
  ) {
    return {
      disabledReason: i18ns.t('remoteTerminalProduct.minimumDeviceCountRequired', {
        count: item.minimumDeviceCount,
      }),
    }
  }

  if (
    form.purchaseMode !== 'merge' &&
    Number(form.terminalCount || 0) < getConfiguredMinimumTerminalCount(item)
  ) {
    return {
      disabledReason: i18ns.t('remoteTerminalProduct.minimumTerminalCountRequired', {
        count: item.minimumTerminalCount,
      }),
    }
  }

  if (
    getConfiguredMaximumDeviceCount(item) != null &&
    Number(form.deviceCount || 0) > Number(getConfiguredMaximumDeviceCount(item))
  ) {
    return {
      disabledReason: i18ns.t('remoteTerminalProduct.maximumDeviceCountExceeded', {
        count: item.maxDeviceCount,
      }),
    }
  }

  if (
    getConfiguredMaximumTerminalCount(item) != null &&
    Number(form.terminalCount || 0) > Number(getConfiguredMaximumTerminalCount(item))
  ) {
    return {
      disabledReason: i18ns.t('remoteTerminalProduct.maximumTerminalCountExceeded', {
        count: item.maxTerminalCount,
      }),
    }
  }

  if (Number(form.deviceCount || 0) > 0 && !supportsDevice(item)) {
    return { disabledReason: i18ns.t('remoteTerminalProduct.unsupportedDevicePurchase') }
  }

  if (Number(form.terminalCount || 0) > 0 && !supportsTerminal(item)) {
    return { disabledReason: i18ns.t('remoteTerminalProduct.unsupportedTerminalPurchase') }
  }

  if (Number(form.deviceCount || 0) <= 0 && Number(form.terminalCount || 0) <= 0) {
    return { disabledReason: i18ns.t('remoteTerminalProduct.purchaseSelectionRequired') }
  }

  if (mergeTarget && Number(form.purchaseUnits || 0) === 0) {
    const addD = Math.max(0, Number(form.deviceCount || 0) - Number(mergeTarget.deviceLimit || 0))
    const addT = Math.max(
      0,
      Number(form.terminalCount || 0) - Number(mergeTarget.terminalLimit || 0),
    )
    if (addD <= 0 && addT <= 0) {
      return { disabledReason: i18ns.t('remoteTerminalProduct.mergeNoChangeRequired') }
    }
  }

  if (getEstimatedPrice(item) > currentBalance.value) {
    return { disabledReason: i18ns.t('remoteTerminalProduct.insufficientBalance') }
  }

  return { disabledReason: '' }
}

const handlePurchaseCountChange = (
  item: RemoteTerminalProductTemplateDto,
  preferredUnit: 'device' | 'terminal',
) => {
  applyNormalizedPurchaseForm(item, preferredUnit)
}

const handlePurchaseModeChange = (item: RemoteTerminalProductTemplateDto) => {
  if (getPurchaseForm(item.id).purchaseMode === 'merge') {
    ensurePurchaseForm(item.id).purchaseUnits = 0
  }
  applyNormalizedPurchaseForm(item)
}

const handleMergeTargetChange = (item: RemoteTerminalProductTemplateDto) => {
  applyNormalizedPurchaseForm(item)
}

const refreshAll = async () => {
  loading.value = true
  try {
    const probeDevices = (remoteTerminalService as { probeDevices?: () => Promise<unknown> })
      .probeDevices
    if (typeof probeDevices === 'function') {
      await probeDevices.call(remoteTerminalService).catch(() => undefined)
    }
    const [published, myEntitlements, myDevices, mySessions, myBalance] = await Promise.all([
      remoteTerminalProductService.listPublishedTemplates(),
      remoteTerminalProductService.listMyEntitlements({ page: 1, pageSize: 100 }),
      remoteTerminalProductService.listMyDevices({ page: 1, pageSize: 100 }),
      remoteTerminalService.listSessions(),
      balanceService.getMyBalance(),
    ])
    templates.value = published || []
    entitlements.value = myEntitlements.records || []
    syncPurchaseForms(templates.value)
    devices.value = myDevices.records || []
    sessions.value = mySessions || []
    currentBalance.value = Number(myBalance.balance || 0)
  } catch (error) {
    ElMessage.error(toErrorMessage(error, i18ns.t('remoteTerminalProduct.refreshFailed')))
  } finally {
    loading.value = false
  }
}

const handleClaimTemplate = async (item: RemoteTerminalProductTemplateDto) => {
  const claimState = getClaimState(item)
  if (claimState.disabledReason) {
    ElMessage.warning(claimState.disabledReason)
    return
  }

  const form = applyNormalizedPurchaseForm(item)
  const estimatedPrice = getEstimatedPrice(item)
  const mergeTarget = getSelectedMergeTarget(item, form)

  try {
    await ElMessageBox.confirm(
      form.purchaseMode === 'merge'
        ? estimatedPrice === 0
          ? i18ns.t('remoteTerminalProduct.claimMergeFreeConfirm', {
              name: item.name,
              target: mergeTarget?.name || '-',
            })
          : i18ns.t('remoteTerminalProduct.claimMergeConfirm', {
              name: item.name,
              target: mergeTarget?.name || '-',
              amount: formatPrice(estimatedPrice, item.currency),
            })
        : estimatedPrice === 0
          ? i18ns.t('remoteTerminalProduct.claimFreeConfirm', {
              name: item.name,
            })
          : i18ns.t('remoteTerminalProduct.claimConfirm', {
              name: item.name,
              amount: formatPrice(estimatedPrice, item.currency),
            }),
      i18ns.t('remoteTerminalProduct.claimConfirmTitle'),
      {
        type: 'warning',
      },
    )
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(toErrorMessage(error, i18ns.t('remoteTerminalProduct.claimFailed')))
    return
  }

  claimingTemplateId.value = item.id
  try {
    await remoteTerminalProductService.claimTemplate({
      templateId: item.id,
      name: form.entitlementName.trim() || undefined,
      purchaseUnits: Number(form.purchaseUnits),
      deviceCount: Number(form.deviceCount),
      terminalCount: Number(form.terminalCount),
      targetEntitlementId: form.purchaseMode === 'merge' ? form.targetEntitlementId : undefined,
    })
    ElMessage.success(i18ns.t('remoteTerminalProduct.claimSuccess'))
    purchaseForms[item.id] = createDefaultPurchaseForm()
    await refreshAll()
  } catch (error) {
    ElMessage.error(toErrorMessage(error, i18ns.t('remoteTerminalProduct.claimFailed')))
  } finally {
    claimingTemplateId.value = undefined
  }
}

const handleRotateMyToken = async (row: RemoteTerminalUserEntitlementDto) => {
  if (!hasDeviceQuota(row.deviceLimit)) return

  try {
    await ElMessageBox.confirm(
      i18ns.t('remoteTerminalProduct.rotateTokenConfirm'),
      i18ns.t('remoteTerminalProduct.rotateTokenTitle'),
      {
        type: 'warning',
      },
    )

    rotatingEntitlementId.value = row.id
    const rotated = await remoteTerminalProductService.rotateMyRegistrationToken(row.id, {})

    try {
      if (rotated.token) {
        await copyToClipboard(rotated.token, false)
        ElMessage.success(i18ns.t('remoteTerminalProduct.rotateTokenSuccessAndCopied'))
      } else {
        ElMessage.success(i18ns.t('remoteTerminalProduct.rotateTokenSuccess'))
      }
    } catch {
      ElMessage.success(i18ns.t('remoteTerminalProduct.rotateTokenSuccess'))
    }

    await refreshAll()
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(toErrorMessage(error, i18ns.t('remoteTerminalProduct.rotateTokenFailed')))
  } finally {
    rotatingEntitlementId.value = undefined
  }
}

// Install Agent dialog
const installDialogVisible = ref(false)
const installOs = ref<RemoteTerminalPlatform>('linux')
const installArch = ref<'x64' | 'arm64'>('x64')
const installToken = ref('')
const installVersion = ref('')
const installVersionLoading = ref(false)
const installVersionError = ref(false)
const installVersionOptions = ref<string[]>([])
const installProxy = ref('')
const installShowProgress = ref(true)
const installRunBackground = ref(true)
const installUseStaticToken = ref(false)
let installCurrentRow: RemoteTerminalBoundDeviceDto | RemoteTerminalUserEntitlementDto | null = null

const installCommands = computed(() => {
  const token = installToken.value
  const os = installOs.value
  const arch = installArch.value
  const ver = installVersion.value
  const proxy = installProxy.value.trim()
  const progress = installShowProgress.value
  const background = installRunBackground.value
  const ext = os === 'windows' ? '.exe' : ''
  const filename = `rtc-agent-${ver}-${os}-${arch}${ext}`
  const baseUrl = `https://github.com/quyansiyuanwang/Quyan-RemoteTerminalCloud/releases/download/${ver}/${filename}`
  const isReverseProxy = proxy.startsWith('http://') || proxy.startsWith('https://')
  const url = isReverseProxy
    ? `${proxy.replace(/\/$/, '')}/${baseUrl.replace(/^https?:\/\//, '')}`
    : baseUrl
  const env = `RTC_REGISTRATION_TOKEN="${token}"`

  const bgSuffix = background ? ' start' : ''

  if (os === 'windows') {
    const curlProgress = progress ? '' : '-s '
    const curlProxy = !isReverseProxy && proxy ? `-x "${proxy}" ` : ''
    const psProxy = !isReverseProxy && proxy ? ` -Proxy "http://${proxy}"` : ''
    return [
      {
        label: 'PowerShell (推荐)',
        command: `$env:RTC_REGISTRATION_TOKEN="${token}"; Invoke-WebRequest -Uri "${url}"${psProxy} -OutFile rtc-agent.exe; .\\rtc-agent.exe${bgSuffix}`,
      },
      {
        label: 'PowerShell (irm)',
        command: `powershell -ExecutionPolicy ByPass -c "$env:RTC_REGISTRATION_TOKEN='${token}'; Invoke-WebRequest '${url}'${psProxy} -OutFile rtc-agent.exe; .\\rtc-agent.exe${bgSuffix}"`,
      },
      {
        label: 'CMD (curl)',
        command: `set RTC_REGISTRATION_TOKEN=${token} && curl ${curlProxy}${curlProgress}-fL "${url}" -o rtc-agent.exe && rtc-agent.exe${bgSuffix}`,
      },
    ]
  }

  const curlFlag = progress ? '-fL' : '-fsSL'
  const wgetFlag = progress ? '' : '-q'
  const curlProxy = !isReverseProxy && proxy ? `-x "${proxy}" ` : ''
  const wgetProxy = !isReverseProxy && proxy ? `https_proxy="${proxy}" ` : ''
  return [
    {
      label: 'bash / sh (curl)',
      command: `${env} curl ${curlProxy}${curlFlag} "${url}" -o rtc-agent && chmod +x rtc-agent && ./rtc-agent${bgSuffix}`,
    },
    {
      label: 'bash / sh (wget)',
      command: `${wgetProxy}${env} wget ${wgetFlag}O rtc-agent "${url}" && chmod +x rtc-agent && ./rtc-agent${bgSuffix}`,
    },
  ]
})

const copyCommand = async (command: string) => {
  try {
    await copyToClipboard(command, false)
    ElMessage.success(i18ns.t('remoteTerminalProduct.commandCopied'))
  } catch (error) {
    ElMessage.error(toErrorMessage(error, i18ns.t('copyFailed')))
  }
}

const openInstallDialog = async (
  row: RemoteTerminalBoundDeviceDto | RemoteTerminalUserEntitlementDto,
) => {
  installCurrentRow = row
  const entitlementId = 'entitlementId' in row ? row.entitlementId : row.id
  installOs.value = ('platform' in row ? (row.platform as RemoteTerminalPlatform) : null) ?? 'linux'
  installArch.value = 'x64'
  installToken.value = ''
  installDialogVisible.value = true
  if (!installVersion.value) {
    await fetchInstallVersion()
  }
  if (installUseStaticToken.value) {
    const entitlement = 'entitlementId' in row ? row : row
    installToken.value =
      ('registrationToken' in entitlement ? entitlement.registrationToken?.token : undefined) ?? ''
  } else {
    try {
      const result = await remoteTerminalProductService.issueMyInstallToken(entitlementId)
      installToken.value = result.token
    } catch (error) {
      ElMessage.error(
        toErrorMessage(error, i18ns.t('remoteTerminalProduct.fetchInstallTokenFailed')),
      )
    }
  }
}

const onInstallUseStaticTokenChange = async (val: boolean) => {
  if (!installCurrentRow) return
  const row = installCurrentRow
  const entitlementId = 'entitlementId' in row ? row.entitlementId : row.id
  installToken.value = ''
  if (val) {
    installToken.value =
      ('registrationToken' in row ? row.registrationToken?.token : undefined) ?? ''
  } else {
    try {
      const result = await remoteTerminalProductService.issueMyInstallToken(entitlementId)
      installToken.value = result.token
    } catch (error) {
      ElMessage.error(
        toErrorMessage(error, i18ns.t('remoteTerminalProduct.fetchInstallTokenFailed')),
      )
    }
  }
}

const fetchInstallVersion = async () => {
  installVersionLoading.value = true
  installVersionError.value = false
  try {
    const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/v1/json/rtc-versions`)
    const data = await res.json()
    const tags: string[] = Array.isArray(data?.data?.data) ? data.data.data.filter(Boolean) : []
    installVersionOptions.value = tags
    if (tags.length > 0) {
      installVersion.value = tags[0]!
    } else {
      installVersionError.value = true
    }
  } catch {
    installVersionError.value = true
  } finally {
    installVersionLoading.value = false
  }
}

const copyToken = async (token: string) => {
  try {
    await copyToClipboard(token, false)
    ElMessage.success(i18ns.t('remoteTerminalProduct.tokenCopied'))
  } catch (error) {
    ElMessage.error(toErrorMessage(error, i18ns.t('copyFailed')))
  }
}

const goConsole = async () => {
  await router.push({ name: 'remoteTerminal' })
}

const resetUnbindDialogState = () => {
  unbindDialogVisible.value = false
  unbindAgreementChecked.value = false
  unbindTargetDeviceId.value = undefined
  unbindReminder.value = undefined
}

const closeUnbindDialog = () => {
  if (unbindReminderLoading.value || revokingDeviceId.value) return
  resetUnbindDialogState()
}

const handleRevokeMyDevice = async (id: string) => {
  try {
    unbindReminderLoading.value = true
    unbindAgreementChecked.value = false
    unbindTargetDeviceId.value = id
    unbindDialogVisible.value = true
    unbindReminder.value = await remoteTerminalProductService.getMyDeviceUnbindReminder(id)
  } catch (error) {
    unbindDialogVisible.value = false
    unbindTargetDeviceId.value = undefined
    unbindReminder.value = undefined
    ElMessage.error(toErrorMessage(error, i18ns.t('remoteTerminalProduct.revokeFailed')))
  } finally {
    unbindReminderLoading.value = false
  }
}

const confirmRevokeMyDevice = async () => {
  const id = unbindTargetDeviceId.value
  if (!id || !unbindReminder.value || !unbindAgreementChecked.value) return

  revokingDeviceId.value = id
  try {
    await remoteTerminalProductService.revokeMyDevice(id)
    ElMessage.success(i18ns.t('deleteSuccess'))
    resetUnbindDialogState()
    await refreshAll()
  } catch (error) {
    ElMessage.error(toErrorMessage(error, i18ns.t('remoteTerminalProduct.revokeFailed')))
  } finally {
    revokingDeviceId.value = undefined
  }
}

onMounted(async () => {
  await permissionService.ensureLoaded()
  await refreshAll()
})
</script>

<style scoped>
.page-wrap {
  width: 100%;
}

.remote-terminal-product-card :deep(.el-card__body) {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.header-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.title {
  font-size: 16px;
  font-weight: 600;
}

.subtitle,
.secondary-text,
.label {
  color: var(--el-text-color-secondary);
}

.unbind-dialog {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 120px;
}

.unbind-dialog__warning {
  color: var(--el-color-danger);
  font-weight: 600;
}

.unbind-dialog__line {
  line-height: 1.6;
}

.summary-grid,
.plan-grid {
  width: 100%;
}

.summary-card,
.plan-card {
  border: 1px solid var(--el-border-color-light);
}

.plan-card :deep(.el-card__body) {
  padding: 12px;
}

.summary-label {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.summary-value {
  margin-top: 8px;
  font-size: 28px;
  font-weight: 700;
}

.plan-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 400px));
  justify-content: flex-start;
  gap: 10px;
}

.card-head {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 8px;
}

.card-tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: flex-start;
}

.card-title {
  font-size: 14px;
  font-weight: 600;
}

.card-description {
  margin-top: 2px;
  display: -webkit-box;
  line-clamp: 2;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  line-height: 1.35;
  font-size: 12px;
}

.card-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px 8px;
}

.compact-field .value {
  font-size: 13px;
  font-weight: 600;
}

.purchase-form {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--el-border-color-lighter);
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 8px;
}

.purchase-cell {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}

.purchase-cell-row {
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.purchase-cell-hint {
  align-items: flex-start;
}

.compact-input {
  width: 104px;
}

.compact-select {
  width: 100%;
}

.mini-label {
  font-size: 12px;
}

.mini-helper {
  font-size: 12px;
  line-height: 1.4;
}

.plan-actions {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
}

.compact-actions {
  padding-top: 2px;
}

.total-box {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.total-value {
  font-size: 14px;
  font-weight: 700;
}

.price-breakdown-line {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  white-space: pre;
  line-height: 1.6;
}

.field,
.token-stack {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.token-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.permission-empty {
  padding: 24px 0;
}

@media (max-width: 768px) {
  .header-row,
  .plan-actions {
    flex-direction: column;
    align-items: flex-start;
  }

  .purchase-form,
  .card-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .plan-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .purchase-cell-row {
    flex-direction: column;
    align-items: flex-start;
  }

  .compact-input {
    width: 100%;
  }
}
</style>
