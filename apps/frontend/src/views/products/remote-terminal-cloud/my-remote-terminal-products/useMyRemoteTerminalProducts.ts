import { ElMessage, ElMessageBox } from 'element-plus'
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { i18ns } from '@/locales'
import type { I18nENAvailableKeys } from '@/locales'
import { MANAGED_STATUS } from '@/constant/status'
import type {
  RemoteTerminalBillingUnit,
  RemoteTerminalBoundDeviceDto,
  RemoteTerminalPlatform,
  RemoteTerminalProductTemplateDto,
  RemoteTerminalSessionSummaryDto,
  RemoteTerminalUnbindReminderDto,
  RemoteTerminalUserEntitlementDto,
} from '@/client/types.gen'
import { balanceService } from '@/service/balanceService'
import { permissionService } from '@/service/permissionService'
import { remoteTerminalProductService } from '@/service/remoteTerminalProductService'
import { remoteTerminalService } from '@/service/remoteTerminalService'
import { usePermissionStore } from '@/stores/permissionStore'
import { copyToClipboard } from '@/utils/common'

type EntitlementStatus = 'active' | 'pending' | 'expired' | 'disabled'
type PurchaseMode = 'new' | 'merge'

type InstallDialogTarget = RemoteTerminalBoundDeviceDto | RemoteTerminalUserEntitlementDto

type RemoteTerminalProductBreakdownTranslationKey = Extract<
  I18nENAvailableKeys,
  `remoteTerminalProduct.breakdown${string}`
>

const REMOTE_TERMINAL_PRODUCT_BREAKDOWN_KEYS = {
  breakdownRenewal: 'remoteTerminalProduct.breakdownRenewal',
  breakdownRenewalOnly: 'remoteTerminalProduct.breakdownRenewalOnly',
  breakdownUpgrade: 'remoteTerminalProduct.breakdownUpgrade',
  breakdownDevice: 'remoteTerminalProduct.breakdownDevice',
  breakdownTerminal: 'remoteTerminalProduct.breakdownTerminal',
  breakdownSubtotal: 'remoteTerminalProduct.breakdownSubtotal',
  breakdownTotal: 'remoteTerminalProduct.breakdownTotal',
  breakdownOldQuota: 'remoteTerminalProduct.breakdownOldQuota',
  breakdownNewQuota: 'remoteTerminalProduct.breakdownNewQuota',
  breakdownRemainingDays: 'remoteTerminalProduct.breakdownRemainingDays',
  breakdownDeviceUpgrade: 'remoteTerminalProduct.breakdownDeviceUpgrade',
  breakdownTerminalUpgrade: 'remoteTerminalProduct.breakdownTerminalUpgrade',
  breakdownNewDevice: 'remoteTerminalProduct.breakdownNewDevice',
  breakdownNewTerminal: 'remoteTerminalProduct.breakdownNewTerminal',
} satisfies Record<
  | 'breakdownRenewal'
  | 'breakdownRenewalOnly'
  | 'breakdownUpgrade'
  | 'breakdownDevice'
  | 'breakdownTerminal'
  | 'breakdownSubtotal'
  | 'breakdownTotal'
  | 'breakdownOldQuota'
  | 'breakdownNewQuota'
  | 'breakdownRemainingDays'
  | 'breakdownDeviceUpgrade'
  | 'breakdownTerminalUpgrade'
  | 'breakdownNewDevice'
  | 'breakdownNewTerminal',
  RemoteTerminalProductBreakdownTranslationKey
>

export interface PurchaseFormState {
  purchaseMode: PurchaseMode
  targetEntitlementId?: string
  entitlementName: string
  purchaseUnits: number
  deviceCount: number
  terminalCount: number
}

export const useMyRemoteTerminalProducts = () => {
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
  let installCurrentRow: InstallDialogTarget | null = null

  const canView = computed(() => Boolean(permissionStore))

  const nowMs = ref(Date.now())
  const clockTimer = setInterval(() => {
    nowMs.value = Date.now()
  }, 1_000)

  onUnmounted(() => clearInterval(clockTimer))

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

  const supportsDevice = (item: { devicePrice?: number }) => item.devicePrice != null
  const supportsTerminal = (item: { terminalPrice?: number }) => item.terminalPrice != null

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

  const tBreakdown = (
    key: keyof typeof REMOTE_TERMINAL_PRODUCT_BREAKDOWN_KEYS,
    params?: Record<string, unknown>,
  ) => i18ns.t(REMOTE_TERMINAL_PRODUCT_BREAKDOWN_KEYS[key], params)

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

  const ensurePurchaseForm = (id: string): PurchaseFormState => {
    if (!purchaseForms[id]) {
      purchaseForms[id] = createDefaultPurchaseForm()
    }

    return purchaseForms[id]
  }

  const getPurchaseForm = (id: string): PurchaseFormState =>
    purchaseForms[id] ?? createDefaultPurchaseForm()

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

  const hasDeviceQuota = (deviceLimit?: number) => Number(deviceLimit || 0) > 0

  const formatPurchaseLimit = (item: RemoteTerminalProductTemplateDto) => {
    if (!item.purchaseLimitPerUser || !item.purchaseLimitWindowDays) {
      return i18ns.t('remoteTerminalProduct.unlimitedPurchase')
    }

    return i18ns.t('remoteTerminalProduct.purchaseLimitValue', {
      count: item.purchaseLimitPerUser,
      days: item.purchaseLimitWindowDays,
    })
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

  const getNormalizedPurchaseForm = (
    item: RemoteTerminalProductTemplateDto,
    preferredUnit: 'device' | 'terminal' = 'device',
  ) => normalizePurchaseFormForTemplate(item, getPurchaseForm(item.id), preferredUnit)

  const getSelectedMergeTarget = (
    item: RemoteTerminalProductTemplateDto,
    form: PurchaseFormState = getNormalizedPurchaseForm(item),
  ) => {
    const targetId = form.targetEntitlementId
    return getMergeCandidates(item).find((entitlement) => entitlement.id === targetId)
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

  const formatEntitlementOptionLabel = (row: RemoteTerminalUserEntitlementDto) => {
    const statusLabel = i18ns.t(statusTextKey(entitlementStatus(row)))
    return `${row.name} · ${statusLabel} · ${row.deviceLimit}${i18ns.t('remoteTerminalProduct.deviceUnit')}/${row.terminalLimit}${i18ns.t('remoteTerminalProduct.terminalUnit')} · ${formatDateTime(row.endAt)}`
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
    const form = getNormalizedPurchaseForm(item)
    const mergeTarget =
      form.purchaseMode === 'merge' ? getSelectedMergeTarget(item, form) : undefined
    const billingUnitDays = getBillingUnitDays(item.billingUnit)

    if (mergeTarget) {
      const newDeviceCount = Number(form.deviceCount || 0)
      const newTerminalCount = Number(form.terminalCount || 0)
      const units = Number(form.purchaseUnits || 0)

      const renewalAmount =
        units *
        ((supportsDevice(item) ? Number(item.devicePrice || 0) * newDeviceCount : 0) +
          (supportsTerminal(item) ? Number(item.terminalPrice || 0) * newTerminalCount : 0))

      const additionalDeviceCount = Math.max(
        0,
        newDeviceCount - Number(mergeTarget.deviceLimit || 0),
      )
      const additionalTerminalCount = Math.max(
        0,
        newTerminalCount - Number(mergeTarget.terminalLimit || 0),
      )

      if (additionalDeviceCount <= 0 && additionalTerminalCount <= 0) {
        return Math.ceil(renewalAmount)
      }

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
    const form = getNormalizedPurchaseForm(item)
    const mergeTarget =
      form.purchaseMode === 'merge' ? getSelectedMergeTarget(item, form) : undefined
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
      const lines: string[] = []
      if (units > 0) {
        lines.push(tBreakdown('breakdownRenewal'))
        if (supportsDevice(item)) {
          lines.push(
            tBreakdown('breakdownDevice', {
              units,
              unit,
              count: newD,
              price: fp(dPrice),
              total: fp(units * newD * dPrice),
            }),
          )
        }
        if (supportsTerminal(item)) {
          lines.push(
            tBreakdown('breakdownTerminal', {
              units,
              unit,
              count: newT,
              price: fp(tPrice),
              total: fp(units * newT * tPrice),
            }),
          )
        }
        lines.push(tBreakdown('breakdownSubtotal', { total: fp(renewalTotal) }))
      } else {
        lines.push(tBreakdown('breakdownRenewalOnly'))
      }

      if (addD > 0 || addT > 0) {
        const remainingHours = Math.ceil(
          Math.max(0, new Date(mergeTarget.endAt).getTime() - nowMs.value) / (60 * 60 * 1000),
        )
        const upgradeRatio = remainingHours / (billingUnitDays * 24)
        const rh = String(remainingHours)
        const unitHours = billingUnitDays * 24
        lines.push(tBreakdown('breakdownUpgrade'))
        lines.push(tBreakdown('breakdownOldQuota', { device: oldD, terminal: oldT }))
        lines.push(tBreakdown('breakdownNewQuota', { device: newD, terminal: newT }))
        lines.push(tBreakdown('breakdownRemainingDays', { days: rh, unit, unitDays: unitHours }))
        if (addD > 0) {
          lines.push(
            tBreakdown('breakdownDeviceUpgrade', {
              days: rh,
              unitDays: unitHours,
              count: addD,
              price: fp(dPrice),
              unit,
              total: fp(upgradeRatio * addD * dPrice),
            }),
          )
        }
        if (addT > 0) {
          lines.push(
            tBreakdown('breakdownTerminalUpgrade', {
              days: rh,
              unitDays: unitHours,
              count: addT,
              price: fp(tPrice),
              unit,
              total: fp(upgradeRatio * addT * tPrice),
            }),
          )
        }
        const upgradeTotal =
          upgradeRatio *
          ((supportsDevice(item) ? dPrice * addD : 0) +
            (supportsTerminal(item) ? tPrice * addT : 0))
        lines.push(tBreakdown('breakdownSubtotal', { total: fp(upgradeTotal) }))
        lines.push(tBreakdown('breakdownTotal', { total: fp(renewalTotal + upgradeTotal) }))
      } else {
        lines.push(tBreakdown('breakdownTotal', { total: fp(renewalTotal) }))
      }
      return lines
    }

    const d = Number(form.deviceCount || 0)
    const t = Number(form.terminalCount || 0)
    const dPrice = Number(item.devicePrice || 0)
    const tPrice = Number(item.terminalPrice || 0)
    const lines: string[] = []
    if (supportsDevice(item) && d > 0) {
      lines.push(
        tBreakdown('breakdownNewDevice', {
          units,
          unit,
          count: d,
          price: fp(dPrice),
          total: fp(units * d * dPrice),
        }),
      )
    }
    if (supportsTerminal(item) && t > 0) {
      lines.push(
        tBreakdown('breakdownNewTerminal', {
          units,
          unit,
          count: t,
          price: fp(tPrice),
          total: fp(units * t * tPrice),
        }),
      )
    }
    const total =
      units * ((supportsDevice(item) ? dPrice * d : 0) + (supportsTerminal(item) ? tPrice * t : 0))
    if (lines.length > 1) lines.push(tBreakdown('breakdownTotal', { total: fp(total) }))
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

    const mergeTarget =
      form.purchaseMode === 'merge' ? getSelectedMergeTarget(item, form) : undefined

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

  const fetchInstallVersion = async () => {
    installVersionLoading.value = true
    installVersionError.value = false
    try {
      const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/v1/json/rtc-versions`)
      const data = await res.json()
      const tags: string[] = Array.isArray(data?.data?.data) ? data.data.data.filter(Boolean) : []
      installVersionOptions.value = tags
      if (tags.length > 0) {
        installVersion.value = tags[0] || ''
      } else {
        installVersionError.value = true
      }
    } catch {
      installVersionError.value = true
    } finally {
      installVersionLoading.value = false
    }
  }

  const copyCommand = async (command: string) => {
    try {
      await copyToClipboard(command, false)
      ElMessage.success(i18ns.t('remoteTerminalProduct.commandCopied'))
    } catch (error) {
      ElMessage.error(toErrorMessage(error, i18ns.t('copyFailed')))
    }
  }

  const openInstallDialog = async (row: InstallDialogTarget) => {
    installCurrentRow = row
    const entitlementId = 'entitlementId' in row ? row.entitlementId : row.id
    installOs.value =
      ('platform' in row ? (row.platform as RemoteTerminalPlatform) : null) ?? 'linux'
    installArch.value = 'x64'
    installToken.value = ''
    installDialogVisible.value = true
    if (!installVersion.value) {
      await fetchInstallVersion()
    }
    if (installUseStaticToken.value) {
      const entitlement = 'entitlementId' in row ? row : row
      installToken.value =
        ('registrationToken' in entitlement ? entitlement.registrationToken?.token : undefined) ??
        ''
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

  return {
    canView,
    claimingTemplateId,
    closeUnbindDialog,
    confirmRevokeMyDevice,
    copyCommand,
    copyToken,
    currentBalance,
    devices,
    entitlementStatus,
    entitlements,
    fetchInstallVersion,
    formatBillingUnitLabel,
    formatDateTime,
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
    goConsole,
    handleClaimTemplate,
    handleMergeTargetChange,
    handlePurchaseCountChange,
    handlePurchaseModeChange,
    handleRevokeMyDevice,
    handleRotateMyToken,
    hasDeviceQuota,
    installArch,
    installCommands,
    installDialogVisible,
    installOs,
    installProxy,
    installRunBackground,
    installShowProgress,
    installToken,
    installUseStaticToken,
    installVersion,
    installVersionError,
    installVersionLoading,
    installVersionOptions,
    loading,
    onInstallUseStaticTokenChange,
    openInstallDialog,
    refreshAll,
    revokingDeviceId,
    rotatingEntitlementId,
    sessions,
    statusTagType,
    statusTextKey,
    supportsDevice,
    supportsTerminal,
    templates,
    unbindAgreementChecked,
    unbindDialogVisible,
    unbindReminder,
    unbindReminderLoading,
  }
}

export type MyRemoteTerminalProductsState = ReturnType<typeof useMyRemoteTerminalProducts>
