<template>
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
            <el-tag :type="item.publishStatus === 'published' ? 'success' : 'info'" size="small">
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
            <span class="label">{{ i18ns.t('remoteTerminalProduct.deviceUnitPrice') }}</span>
            <span class="value">{{
              formatUnitPrice(item.devicePrice, item.currency, item.billingUnit)
            }}</span>
          </div>
          <div class="field compact-field">
            <span class="label">{{ i18ns.t('remoteTerminalProduct.terminalUnitPrice') }}</span>
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
            <span class="label mini-label">{{ i18ns.t('remoteTerminalProduct.planName') }}</span>
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
          <div v-if="getPurchaseForm(item.id).purchaseMode === 'merge'" class="purchase-cell">
            <span class="label mini-label">{{ i18ns.t('remoteTerminalProduct.mergeTarget') }}</span>
            <el-select
              v-model="getPurchaseForm(item.id).targetEntitlementId"
              size="small"
              class="compact-select"
              :placeholder="i18ns.t('remoteTerminalProduct.mergeTargetPlaceholder')"
              @change="handleMergeTargetChange(item)"
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
            <span class="label mini-label">{{ i18ns.t('remoteTerminalProduct.deviceCount') }}</span>
            <el-input-number
              v-model="getPurchaseForm(item.id).deviceCount"
              :min="getMinimumDeviceCount(item)"
              :max="item.maxDeviceCount ?? undefined"
              :step="1"
              :disabled="!supportsDevice(item)"
              size="small"
              class="compact-input"
              @change="handlePurchaseCountChange(item, 'device')"
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
              size="small"
              class="compact-input"
              @change="handlePurchaseCountChange(item, 'terminal')"
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
            <div v-for="line in getPriceBreakdown(item)" :key="line" class="price-breakdown-line">
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
                getEstimatedPrice(item) === 0 && getPurchaseForm(item.id).purchaseMode !== 'merge'
                  ? i18ns.t('remoteTerminalProduct.claimFreePlan')
                  : i18ns.t('remoteTerminalProduct.claimPlan')
              }}
            </el-button>
          </el-tooltip>
        </div>
      </el-card>
    </div>
  </el-tab-pane>
</template>

<script setup lang="ts">
import { i18ns } from '@/locales'
import { useMyRemoteTerminalProductsContext } from '../context'

const {
  claimingTemplateId,
  formatBillingUnitLabel,
  formatEntitlementOptionLabel,
  formatPrice,
  formatPurchaseLimit,
  formatUnitPrice,
  getClaimState,
  getEstimatedPrice,
  getMergeCandidates,
  getMinimumDeviceCount,
  getMinimumTerminalCount,
  getPriceBreakdown,
  getPurchaseForm,
  handleClaimTemplate,
  handleMergeTargetChange,
  handlePurchaseCountChange,
  handlePurchaseModeChange,
  loading,
  supportsDevice,
  supportsTerminal,
  templates,
} = useMyRemoteTerminalProductsContext()
</script>
