<template>
  <div
    :class="
      embedded ? 'monthly-pass-purchase-embedded' : isDesktop ? 'desktop-page' : 'mobile-page'
    "
  >
    <el-alert
      v-if="monthlyPassLoadError"
      type="error"
      :closable="false"
      style="margin-bottom: 16px"
    >
      {{ monthlyPassLoadError }}
    </el-alert>

    <div v-loading="loadingPublishedMonthlyPasses">
      <el-empty
        v-if="!monthlyPassLoadError && !publishedMonthlyPasses.length"
        :description="i18ns.t('apiDoc.monthlyPassesEmpty')"
      />

      <div v-else class="monthly-pass-doc-grid">
        <el-card
          v-for="template in publishedMonthlyPasses"
          :key="template.id"
          class="monthly-pass-doc-card"
          shadow="never"
        >
          <div class="monthly-pass-doc-hero">
            <div class="monthly-pass-doc-header">
              <div>
                <div class="monthly-pass-doc-title">{{ template.name }}</div>
              </div>
            </div>

            <div class="monthly-pass-doc-pricing">
              <div class="monthly-pass-doc-pricing__left">
                <div class="monthly-pass-doc-original">
                  {{ i18ns.t('monthlyPass.originalPrice') }} ·
                  {{ formatMonthlyPassPrice(template.originalPrice) }}
                </div>
                <div class="monthly-pass-doc-discount-row">
                  <span class="monthly-pass-doc-price">{{
                    formatMonthlyPassPrice(template.discountedPrice)
                  }}</span>
                  <span class="monthly-pass-doc-discount-tag">{{
                    formatMonthlyPassPercent(template.discountPercent)
                  }}</span>
                </div>
              </div>
              <div v-if="getMonthlyPassSavings(template) != null" class="monthly-pass-doc-savings">
                <span class="monthly-pass-doc-savings__label">{{
                  i18ns.t('monthlyPass.savingsAmount')
                }}</span>
                <strong>{{
                  formatMonthlyPassPrice(getMonthlyPassSavings(template) ?? undefined)
                }}</strong>
              </div>
            </div>

            <div class="monthly-pass-doc-value-grid">
              <div class="monthly-pass-doc-value-card monthly-pass-doc-value-card--primary">
                <span>{{ monthlyPassTotalQuotaLabel }}</span>
                <strong>{{ formatMonthlyPassQuotaValue(template.defaultQuota, 'amount') }}</strong>
              </div>
              <div class="monthly-pass-doc-value-card">
                <span>{{ i18ns.t('monthlyPass.dailyQuota') }}</span>
                <strong>{{ formatMonthlyPassDailyQuota(template.dailyQuota, 'amount') }}</strong>
              </div>
            </div>
          </div>

          <div class="monthly-pass-doc-meta-grid">
            <div class="monthly-pass-doc-meta-item">
              <span class="monthly-pass-doc-meta-item__label">{{
                i18ns.t('monthlyPass.quotaUnit')
              }}</span>
              <strong>{{ formatMonthlyPassQuotaUnit(template.quotaUnit) }}</strong>
            </div>
            <div class="monthly-pass-doc-meta-item">
              <span class="monthly-pass-doc-meta-item__label">{{
                i18ns.t('monthlyPass.quotaWindowHours')
              }}</span>
              <strong>{{ formatMonthlyPassQuotaWindowHours(template.quotaWindowHours) }}</strong>
            </div>
            <div class="monthly-pass-doc-meta-item">
              <span class="monthly-pass-doc-meta-item__label">{{
                i18ns.t('monthlyPass.publishedAt')
              }}</span>
              <strong>{{
                formatMonthlyPassDateTime(template.publishedAt || template.createTime)
              }}</strong>
            </div>
            <div class="monthly-pass-doc-meta-item">
              <span class="monthly-pass-doc-meta-item__label">{{
                i18ns.t('monthlyPass.purchaseAmount')
              }}</span>
              <strong>{{ formatMonthlyPassPurchaseAmount(template) }}</strong>
            </div>
            <div class="monthly-pass-doc-meta-item monthly-pass-doc-meta-item--full">
              <span class="monthly-pass-doc-meta-item__label">{{
                i18ns.t('monthlyPass.purchaseLimit')
              }}</span>
              <strong>{{ formatPurchaseLimit(template) }}</strong>
            </div>
            <div class="monthly-pass-doc-meta-item monthly-pass-doc-meta-item--full">
              <span class="monthly-pass-doc-meta-item__label">{{
                i18ns.t('monthlyPass.allowedModels')
              }}</span>
              <strong>{{
                formatMonthlyPassScope(template.allowedModels, i18ns.t('monthlyPass.allModels'))
              }}</strong>
            </div>
            <div class="monthly-pass-doc-meta-item monthly-pass-doc-meta-item--full">
              <span class="monthly-pass-doc-meta-item__label">{{
                i18ns.t('monthlyPass.allowedChannels')
              }}</span>
              <template v-if="template.allowedChannels?.length">
                <div
                  v-if="resolveMonthlyPassAllowedChannelNames(template.allowedChannels).length"
                  class="monthly-pass-doc-tag-list"
                >
                  <el-tag
                    v-for="channelName in resolveMonthlyPassAllowedChannelNames(
                      template.allowedChannels,
                    )"
                    :key="`${template.id}-${channelName}`"
                    effect="plain"
                    round
                    class="monthly-pass-doc-scope-tag"
                  >
                    {{ channelName }}
                  </el-tag>
                </div>
                <strong v-else>{{ monthlyPassChannelNamesLoadingLabel }}</strong>
              </template>
              <strong v-else>{{ i18ns.t('monthlyPass.allChannels') }}</strong>
            </div>
          </div>

          <div class="monthly-pass-doc-actions">
            <div class="monthly-pass-doc-validity">
              {{ formatMonthlyPassValidity(template) }}
            </div>
            <div
              v-if="getMonthlyPassClaimDisabledReason(template)"
              class="monthly-pass-doc-disabled-note"
            >
              {{ getMonthlyPassClaimDisabledReason(template) }}
            </div>
            <el-button
              type="primary"
              :disabled="!canClaimMonthlyPassTemplate(template)"
              :loading="claimingMonthlyPassId === template.id"
              @click="claimMonthlyPassTemplate(template)"
            >
              {{ i18ns.t('apiDoc.balanceRedeem') }}
            </el-button>
          </div>

          <div v-if="template.description" class="monthly-pass-doc-description-section">
            <div class="monthly-pass-doc-description-header">
              <span class="monthly-pass-doc-description-label">{{ i18ns.t('description') }}</span>
              <el-button
                text
                class="monthly-pass-doc-description-toggle"
                @click="toggleMonthlyPassDescription(template.id)"
              >
                {{
                  isMonthlyPassDescriptionExpanded(template.id)
                    ? monthlyPassCollapseDescriptionText
                    : monthlyPassExpandDescriptionText
                }}
              </el-button>
            </div>
            <el-collapse-transition>
              <div
                v-show="isMonthlyPassDescriptionExpanded(template.id)"
                class="monthly-pass-doc-description"
              >
                {{ template.description }}
              </div>
            </el-collapse-transition>
          </div>
        </el-card>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { i18ns } from '@/locales'
import { balanceService } from '@/service/balanceService'
import { monthlyPassService } from '@/service/monthlyPassService'
import { useApiDocumentationPricing } from '@/composables/useApiDocumentationPricing'
import { usePageDevice } from '@/composables/usePageDevice'
import type { MonthlyPassTemplateDto } from '@/client/types.gen'

withDefaults(
  defineProps<{
    embedded?: boolean
  }>(),
  {
    embedded: false,
  },
)

const { isDesktop } = usePageDevice()
const { channels, loadChannels } = useApiDocumentationPricing()

const loadingPublishedMonthlyPasses = ref(false)
const monthlyPassLoadError = ref('')
const publishedMonthlyPasses = ref<MonthlyPassTemplateDto[]>([])
const expandedMonthlyPassDescriptionIds = ref<string[]>([])
const claimingMonthlyPassId = ref('')
const monthlyPassBalance = ref<number | null>(null)
const loadingMonthlyPassBalance = ref(false)
const monthlyPassTotalQuotaLabel = computed(() =>
  i18ns.refer.value === 'zh-CN' ? '总额度' : 'Total Quota',
)
const monthlyPassExpandDescriptionText = computed(() =>
  i18ns.refer.value === 'zh-CN' ? '展开说明' : 'Show Description',
)
const monthlyPassCollapseDescriptionText = computed(() =>
  i18ns.refer.value === 'zh-CN' ? '收起说明' : 'Hide Description',
)
const monthlyPassChannelNamesLoadingLabel = computed(() =>
  i18ns.refer.value === 'zh-CN' ? '渠道名称加载中' : 'Loading channel names',
)

const toErrorMessage = (error: unknown, fallback: string) => {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }
  return fallback
}

const isIntegerMonthlyPassQuotaUnit = (value?: string) => {
  return value === 'request' || value === 'token'
}

const formatMonthlyPassDecimal = (value: number, precision = 4) => {
  return value.toFixed(precision).replace(/\.?0+$/, '')
}

const formatMonthlyPassQuotaValue = (value?: number, unit?: string) => {
  if (value == null) return '-'
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return '-'
  if (isIntegerMonthlyPassQuotaUnit(unit)) return String(Math.floor(numeric))
  return formatMonthlyPassDecimal(numeric)
}

const formatMonthlyPassDailyQuota = (value?: number, unit?: string) => {
  if (value == null) return i18ns.t('monthlyPass.unlimited')
  return formatMonthlyPassQuotaValue(value, unit)
}

const formatMonthlyPassPrice = (value?: number) => {
  if (value == null) return '-'
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return '-'
  return formatMonthlyPassDecimal(numeric)
}

const formatMonthlyPassPercent = (value?: number) => {
  if (value == null) return '-'
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return '-'
  return `${numeric.toFixed(2)}%`
}

const getMonthlyPassSavings = (template: MonthlyPassTemplateDto) => {
  const originalPrice = Number(template.originalPrice)
  const discountedPrice = Number(template.discountedPrice)
  if (!Number.isFinite(originalPrice) || !Number.isFinite(discountedPrice)) return null

  const savings = originalPrice - discountedPrice
  if (savings <= 0) return null
  return Math.round(savings * 10000) / 10000
}

const formatMonthlyPassQuotaUnit = (value?: string) => {
  if (value === 'request') return i18ns.t('monthlyPass.quotaUnitRequest')
  if (value === 'token') return i18ns.t('monthlyPass.quotaUnitToken')
  return i18ns.t('monthlyPass.quotaUnitAmount')
}

const formatMonthlyPassQuotaWindowHours = (value?: number) => {
  if (value == null || !Number.isFinite(Number(value)) || Number(value) <= 0) {
    return i18ns.t('monthlyPass.unlimited')
  }

  const normalized = Math.floor(Number(value))
  if (normalized % 24 !== 0) return `${normalized}${i18ns.t('monthlyPass.hoursUnit')}`

  return `${normalized}${i18ns.t('monthlyPass.hoursUnit')} (${normalized / 24}${i18ns.t(
    'monthlyPass.daysUnit',
  )})`
}

const formatMonthlyPassScope = (values: string[] | undefined, fallback: string) => {
  if (!values || values.length === 0) return fallback
  return values.join(', ')
}

const monthlyPassChannelNameMap = computed(
  () => new Map(channels.value.map((channel) => [channel.id, channel.name || channel.id])),
)

const resolveMonthlyPassAllowedChannelNames = (values?: string[]) => {
  if (!values || values.length === 0) return []

  return Array.from(
    new Set(
      values
        .map((value) => monthlyPassChannelNameMap.value.get(value))
        .filter((value): value is string => Boolean(value?.trim())),
    ),
  )
}

const isMonthlyPassDescriptionExpanded = (templateId: string) =>
  expandedMonthlyPassDescriptionIds.value.includes(templateId)

const toggleMonthlyPassDescription = (templateId: string) => {
  if (isMonthlyPassDescriptionExpanded(templateId)) {
    expandedMonthlyPassDescriptionIds.value = expandedMonthlyPassDescriptionIds.value.filter(
      (id) => id !== templateId,
    )
    return
  }

  expandedMonthlyPassDescriptionIds.value = [...expandedMonthlyPassDescriptionIds.value, templateId]
}

const formatMonthlyPassDateTime = (value?: string) => {
  if (!value) return '-'
  const time = new Date(value)
  if (Number.isNaN(time.getTime())) return value
  return time.toLocaleString()
}

const getMonthlyPassPurchaseAmount = (template: MonthlyPassTemplateDto) => {
  const discountedPrice = Number(template.discountedPrice)
  const rechargeRatio = Number(template.rechargeRatio)
  if (!Number.isFinite(discountedPrice) || discountedPrice < 0) return null
  if (!Number.isFinite(rechargeRatio) || rechargeRatio <= 0) return null
  return Math.round(discountedPrice * rechargeRatio * 10000) / 10000
}

const formatMonthlyPassPurchaseAmount = (template: MonthlyPassTemplateDto) => {
  const amount = getMonthlyPassPurchaseAmount(template)
  return amount == null ? '-' : formatMonthlyPassPrice(amount)
}

const formatMonthlyPassValidity = (template: MonthlyPassTemplateDto) => {
  const validityDays = Math.floor(Number(template.validityDays))
  return i18ns.t('apiDoc.monthlyPassValidityDays', {
    days: Number.isFinite(validityDays) && validityDays >= 1 ? validityDays : 30,
  })
}

const formatPurchaseLimit = (template: MonthlyPassTemplateDto) => {
  const perUser = Number(template.purchaseLimitPerUser)
  const days = Number(template.purchaseLimitWindowDays)

  if (!Number.isFinite(perUser) || perUser <= 0 || !Number.isFinite(days) || days <= 0) {
    return i18ns.t('monthlyPass.unlimited')
  }

  return i18ns.t('monthlyPass.purchaseLimitValue', { count: perUser, days })
}

const getMonthlyPassClaimDisabledReason = (template: MonthlyPassTemplateDto) => {
  if (!template.allowBalanceRedemption) return i18ns.t('apiDoc.balanceRedeemDisabled')

  const purchaseAmount = getMonthlyPassPurchaseAmount(template)
  if (purchaseAmount == null) return i18ns.t('apiDoc.balanceRedeemDisabled')

  if (loadingMonthlyPassBalance.value) return i18ns.t('apiDoc.balanceLoading')

  if (monthlyPassBalance.value != null && monthlyPassBalance.value < purchaseAmount) {
    return i18ns.t('apiDoc.balanceRedeemInsufficient', {
      amount: formatMonthlyPassPrice(purchaseAmount),
    })
  }

  return ''
}

const canClaimMonthlyPassTemplate = (template: MonthlyPassTemplateDto) =>
  !getMonthlyPassClaimDisabledReason(template)

const getMonthlyPassClaimConfirmMessage = (template: MonthlyPassTemplateDto) => {
  const purchaseAmount = getMonthlyPassPurchaseAmount(template)

  if (purchaseAmount == null || purchaseAmount <= 0) {
    return i18ns.t('apiDoc.balanceRedeemFreeConfirm', {
      name: template.name,
    })
  }

  return i18ns.t('apiDoc.balanceRedeemConfirm', {
    name: template.name,
    amount: formatMonthlyPassPrice(purchaseAmount),
  })
}

const claimMonthlyPassTemplate = async (template: MonthlyPassTemplateDto) => {
  const disabledReason = getMonthlyPassClaimDisabledReason(template)
  if (disabledReason) {
    ElMessage.error(disabledReason)
    return
  }

  if (claimingMonthlyPassId.value) return

  try {
    await ElMessageBox.confirm(
      getMonthlyPassClaimConfirmMessage(template),
      i18ns.t('apiDoc.balanceRedeemConfirmTitle'),
      {
        type: 'warning',
        confirmButtonText: i18ns.t('apiDoc.balanceRedeemConfirmButton'),
        cancelButtonText: i18ns.t('cancel'),
        distinguishCancelAndClose: true,
      },
    )
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(toErrorMessage(error, i18ns.t('apiDoc.balanceRedeemFailed')))
    return
  }

  claimingMonthlyPassId.value = template.id

  try {
    const result = await monthlyPassService.claimPublishedTemplate({ templateId: template.id })
    if (!result || typeof result.purchaseAmount !== 'number') {
      throw new Error(i18ns.t('apiDoc.balanceRedeemFailed'))
    }
    ElMessage.success(
      i18ns.t('apiDoc.balanceRedeemSuccess', {
        amount: formatMonthlyPassPrice(result.purchaseAmount),
      }),
    )
    await loadPublishedMonthlyPasses()
  } catch (error) {
    ElMessage.error(toErrorMessage(error, i18ns.t('apiDoc.balanceRedeemFailed')))
  } finally {
    claimingMonthlyPassId.value = ''
  }
}

const loadMonthlyPassBalance = async () => {
  loadingMonthlyPassBalance.value = true
  try {
    const result = await balanceService.getMyBalance()
    monthlyPassBalance.value = Number.isFinite(Number(result.balance))
      ? Number(result.balance)
      : null
  } catch {
    monthlyPassBalance.value = null
  } finally {
    loadingMonthlyPassBalance.value = false
  }
}

const loadPublishedMonthlyPasses = async () => {
  loadingPublishedMonthlyPasses.value = true
  monthlyPassLoadError.value = ''

  try {
    const [templates] = await Promise.all([
      monthlyPassService.listPublishedTemplates(),
      loadMonthlyPassBalance(),
    ])
    publishedMonthlyPasses.value = templates
    if (!channels.value.length) {
      void loadChannels().catch(() => {
        // Keep monthly pass cards usable even if channel names fail to load.
      })
    }
  } catch (error) {
    publishedMonthlyPasses.value = []
    monthlyPassLoadError.value = toErrorMessage(error, i18ns.t('apiDoc.monthlyPassesLoadFailed'))
  } finally {
    loadingPublishedMonthlyPasses.value = false
  }
}

onMounted(async () => {
  await loadPublishedMonthlyPasses()
})
</script>

<style scoped>
.monthly-pass-purchase-card {
  width: 100%;
}

.monthly-pass-purchase-header {
  width: 100%;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.monthly-pass-purchase-title {
  font-size: 18px;
  font-weight: 700;
}

.monthly-pass-purchase-subtitle {
  margin-top: 6px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.monthly-pass-purchase-header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.monthly-pass-purchase-alert {
  margin-bottom: 16px;
}

.monthly-pass-purchase-balance-bar {
  margin-bottom: 16px;
  padding: 14px 16px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 12px;
  background: var(--el-fill-color-blank);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.monthly-pass-purchase-balance-label {
  color: var(--el-text-color-secondary);
}

.monthly-pass-doc-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
  gap: 18px;
}

.monthly-pass-doc-card {
  position: relative;
  border: 1px solid var(--surface-card-border);
  border-radius: 22px;
  overflow: hidden;
  background: var(--surface-card-bg);
  color: var(--color-text);
  box-shadow: none;
  backdrop-filter: blur(var(--surface-card-blur));
}

.monthly-pass-doc-card :deep(.el-card__body) {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 0;
}

.monthly-pass-doc-hero {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 22px;
  background: transparent;
  border-bottom: 1px solid color-mix(in srgb, var(--surface-card-border) 78%, transparent);
}

.monthly-pass-doc-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.monthly-pass-doc-title {
  font-size: 22px;
  font-weight: 700;
  color: var(--color-heading);
  word-break: break-word;
  letter-spacing: -0.02em;
}

.monthly-pass-doc-pricing {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 18px;
  border-radius: 18px;
  background: color-mix(in srgb, var(--el-fill-color-blank) 88%, transparent);
  border: 1px solid color-mix(in srgb, var(--surface-card-border) 74%, transparent);
}

.monthly-pass-doc-pricing__left {
  min-width: 0;
}

.monthly-pass-doc-original {
  color: var(--el-text-color-secondary);
  font-size: 13px;
  text-decoration: line-through;
  text-decoration-thickness: 1px;
}

.monthly-pass-doc-discount-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 6px;
}

.monthly-pass-doc-price {
  font-size: 34px;
  line-height: 1;
  font-weight: 800;
  color: var(--color-heading);
  letter-spacing: -0.03em;
}

.monthly-pass-doc-discount-tag {
  display: inline-flex;
  align-items: center;
  padding: 6px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  color: var(--el-color-primary-dark-2);
  background: var(--el-color-primary-light-8);
  border: 1px solid var(--el-color-primary-light-6);
}

.monthly-pass-doc-savings {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}

.monthly-pass-doc-savings__label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.monthly-pass-doc-value-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.monthly-pass-doc-value-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px;
  border-radius: 16px;
  background: color-mix(in srgb, var(--el-fill-color-light) 82%, transparent);
}

.monthly-pass-doc-value-card--primary {
  background: color-mix(in srgb, var(--el-color-primary-light-9) 72%, transparent);
}

.monthly-pass-doc-value-card span {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.monthly-pass-doc-value-card strong {
  font-size: 20px;
}

.monthly-pass-doc-meta-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  padding: 0 22px;
}

.monthly-pass-doc-meta-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.monthly-pass-doc-meta-item--full {
  grid-column: 1 / -1;
}

.monthly-pass-doc-meta-item__label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.monthly-pass-doc-tag-list {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.monthly-pass-doc-scope-tag {
  margin: 0;
}

.monthly-pass-doc-actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 0 22px 22px;
}

.monthly-pass-doc-validity {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.monthly-pass-doc-disabled-note {
  color: var(--el-color-danger);
  font-size: 13px;
  line-height: 1.5;
}

.monthly-pass-doc-description-section {
  border-top: 1px solid color-mix(in srgb, var(--surface-card-border) 68%, transparent);
  padding: 16px 22px 22px;
}

.monthly-pass-doc-description-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.monthly-pass-doc-description-label {
  font-weight: 600;
}

.monthly-pass-doc-description-toggle {
  padding: 0;
}

.monthly-pass-doc-description {
  margin-top: 12px;
  white-space: pre-wrap;
  color: var(--el-text-color-regular);
  line-height: 1.7;
}

@media (max-width: 768px) {
  .monthly-pass-doc-grid {
    grid-template-columns: 1fr;
  }

  .monthly-pass-doc-value-grid,
  .monthly-pass-doc-meta-grid {
    grid-template-columns: 1fr;
  }
}
</style>
