import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { i18ns } from '@/locales'
import { Permission } from '@/constant/permission'
import { remoteTerminalProductService } from '@/service/remoteTerminalProductService'
import { permissionService } from '@/service/permissionService'
import { userService } from '@/service/userService'
import { usePermissionStore } from '@/stores/permissionStore'
import type {
  RemoteTerminalBillingUnit,
  RemoteTerminalBoundDeviceDto,
  RemoteTerminalFilterOptionsDto,
  RemoteTerminalProductTemplateDto,
  RemoteTerminalUserEntitlementDto,
} from '@/client/types.gen'

interface UserOption {
  id: string
  username: string
}

const USER_OPTIONS_PAGE_SIZE = 20

export function useRemoteTerminalProductManagement() {
  const permissionStore = usePermissionStore()

  const loading = ref(false)
  const dialogSubmitting = ref(false)
  const resettingUnbind = ref(false)
  const activeTab = ref<'templates' | 'entitlements' | 'devices'>('templates')

  const templates = ref<RemoteTerminalProductTemplateDto[]>([])
  const entitlements = ref<RemoteTerminalUserEntitlementDto[]>([])
  const devices = ref<RemoteTerminalBoundDeviceDto[]>([])
  const filterOptions = reactive<RemoteTerminalFilterOptionsDto>({
    templateStatusOptions: [],
    assignmentStatusOptions: [],
    deviceStatusOptions: [],
    publishStatusOptions: [],
    templates: [],
  })

  const templateKeyword = ref('')
  const templateStatus = ref<number | undefined>()
  const entitlementFilter = reactive<{ userId?: string; templateId?: string; status?: number }>({})
  const deviceFilter = reactive<{ userId?: string; entitlementId?: string; status?: number }>({})

  const userOptions = ref<UserOption[]>([])
  const userOptionsLoading = ref(false)

  const templateDialogVisible = ref(false)
  const entitlementDialogVisible = ref(false)
  const tokenDialogVisible = ref(false)
  const limitAdjustDialogVisible = ref(false)
  const templateFormRef = ref<FormInstance>()
  const entitlementFormRef = ref<FormInstance>()
  const limitAdjustFormRef = ref<FormInstance>()

  const editingTemplateId = ref<string>()
  const editingEntitlementId = ref<string>()
  const tokenEntitlementId = ref<string>()
  const limitAdjustTarget = ref<RemoteTerminalUserEntitlementDto>()

  const templateForm = reactive({
    name: '',
    description: '',
    billingUnit: 'day' as RemoteTerminalBillingUnit,
    minimumPurchaseUnits: 1,
    maximumPurchaseUnits: undefined as number | undefined,
    devicePrice: undefined as number | undefined,
    terminalPrice: undefined as number | undefined,
    currency: '曲',
    purchaseLimitPerUser: undefined as number | undefined,
    purchaseLimitWindowDays: undefined as number | undefined,
    minimumDeviceCount: undefined as number | undefined,
    minimumTerminalCount: undefined as number | undefined,
    maxDeviceCount: undefined as number | undefined,
    maxTerminalCount: undefined as number | undefined,
  })

  const entitlementForm = reactive({
    userId: '',
    templateId: '',
    name: '',
    description: '',
    startAt: '',
    endAt: '',
    deviceLimit: 1,
    terminalLimit: 1,
    maxDeviceCount: undefined as number | undefined,
    maxTerminalCount: undefined as number | undefined,
    note: '',
  })

  const tokenForm = reactive({
    label: '',
    expiresAt: '',
  })

  const limitAdjustForm = reactive({
    deviceLimit: 0,
    terminalLimit: 0,
    maxDeviceCount: undefined as number | undefined,
    maxTerminalCount: undefined as number | undefined,
  })

  const supportsDevice = (row: { devicePrice?: number }) => row.devicePrice != null
  const supportsTerminal = (row: { terminalPrice?: number }) => row.terminalPrice != null

  const formatBillingUnitLabel = (billingUnit?: RemoteTerminalBillingUnit) => {
    if (billingUnit === 'week') return i18ns.t('remoteTerminalProduct.billingUnitWeek')
    if (billingUnit === 'month') return i18ns.t('remoteTerminalProduct.billingUnitMonth')
    return i18ns.t('remoteTerminalProduct.billingUnitDay')
  }

  const formatPrice = (price?: number, currency?: string) => {
    if (price == null) return '-'
    return `${Number(price)
      .toFixed(4)
      .replace(/\.?0+$/, '')} ${currency || '曲'}`
  }

  const formatUnitPrice = (
    price?: number,
    currency?: string,
    billingUnit?: RemoteTerminalBillingUnit,
  ) => {
    if (price == null) return '-'
    return `${formatPrice(price, currency)} / ${formatBillingUnitLabel(billingUnit)}`
  }

  const validateOfferedUnits = (
    _rule: unknown,
    _value: unknown,
    callback: (error?: Error) => void,
  ) => {
    if (!supportsDevice(templateForm) && !supportsTerminal(templateForm)) {
      callback(new Error(i18ns.t('remoteTerminalProduct.offeredUnitsRequired')))
      return
    }
    callback()
  }

  const validateEntitlementQuota = (
    _rule: unknown,
    _value: unknown,
    callback: (error?: Error) => void,
  ) => {
    if (
      Number(entitlementForm.deviceLimit || 0) <= 0 &&
      Number(entitlementForm.terminalLimit || 0) <= 0
    ) {
      callback(new Error(i18ns.t('remoteTerminalProduct.quotaRequired')))
      return
    }
    callback()
  }

  const validatePurchaseLimitPair = (
    _rule: unknown,
    _value: unknown,
    callback: (error?: Error) => void,
  ) => {
    const hasLimit =
      templateForm.purchaseLimitPerUser !== undefined && templateForm.purchaseLimitPerUser !== null
    const hasWindow =
      templateForm.purchaseLimitWindowDays !== undefined &&
      templateForm.purchaseLimitWindowDays !== null
    if (hasLimit !== hasWindow) {
      callback(new Error(i18ns.t('remoteTerminalProduct.purchaseLimitPairRequired')))
      return
    }
    callback()
  }

  const validateEntitlementDateRange = (
    _rule: unknown,
    _value: unknown,
    callback: (error?: Error) => void,
  ) => {
    if (!entitlementForm.startAt || !entitlementForm.endAt) {
      callback()
      return
    }
    const startAt = new Date(entitlementForm.startAt).getTime()
    const endAt = new Date(entitlementForm.endAt).getTime()
    if (Number.isNaN(startAt) || Number.isNaN(endAt)) {
      callback(new Error(i18ns.t('remoteTerminalProduct.invalidDateTime')))
      return
    }
    if (endAt <= startAt) {
      callback(new Error(i18ns.t('remoteTerminalProduct.endAfterStartRequired')))
      return
    }
    callback()
  }

  const validateStartAt = (_rule: unknown, _value: unknown, callback: (error?: Error) => void) => {
    if (!editingEntitlementId.value && !entitlementForm.startAt.trim()) {
      callback(new Error(i18ns.t('remoteTerminalProduct.startAtRequired')))
      return
    }
    validateEntitlementDateRange(_rule, _value, callback)
  }

  const validateEndAt = (_rule: unknown, _value: unknown, callback: (error?: Error) => void) => {
    if (!editingEntitlementId.value && !entitlementForm.endAt.trim()) {
      callback(new Error(i18ns.t('remoteTerminalProduct.endAtRequired')))
      return
    }
    validateEntitlementDateRange(_rule, _value, callback)
  }

  const templateFormRules: FormRules = {
    name: [
      { required: true, message: i18ns.t('remoteTerminalProduct.nameRequired'), trigger: 'blur' },
    ],
    currency: [
      {
        required: true,
        message: i18ns.t('remoteTerminalProduct.currencyRequired'),
        trigger: 'blur',
      },
    ],
    devicePrice: [{ validator: validateOfferedUnits, trigger: 'change' }],
    terminalPrice: [{ validator: validateOfferedUnits, trigger: 'change' }],
    purchaseLimitPerUser: [{ validator: validatePurchaseLimitPair, trigger: 'change' }],
    purchaseLimitWindowDays: [{ validator: validatePurchaseLimitPair, trigger: 'change' }],
    maximumPurchaseUnits: [
      {
        validator: (_rule: unknown, _value: unknown, callback: (error?: Error) => void) => {
          if (
            templateForm.maximumPurchaseUnits != null &&
            Number(templateForm.minimumPurchaseUnits || 1) > Number(templateForm.maximumPurchaseUnits)
          ) {
            callback(new Error(i18ns.t('remoteTerminalProduct.maximumPurchaseUnitsInvalid')))
            return
          }
          callback()
        },
        trigger: 'change',
      },
    ],
  }

  const entitlementFormRules: FormRules = {
    userId: [
      { required: true, message: i18ns.t('remoteTerminalProduct.userRequired'), trigger: 'change' },
    ],
    startAt: [{ validator: validateStartAt, trigger: 'change' }],
    endAt: [{ validator: validateEndAt, trigger: 'change' }],
    deviceLimit: [{ validator: validateEntitlementQuota, trigger: 'change' }],
    terminalLimit: [{ validator: validateEntitlementQuota, trigger: 'change' }],
  }

  const toErrorMessage = (error: unknown, fallback: string) => {
    if (error && typeof error === 'object' && 'message' in error) {
      const message = (error as { message?: unknown }).message
      if (typeof message === 'string' && message.trim()) return message
    }
    return fallback
  }

  const canReadTemplate = computed(() =>
    permissionStore.hasPermission(Permission.REMOTE_TERMINAL_PRODUCT_READ),
  )
  const canReadAssignment = computed(() =>
    permissionStore.hasPermission(Permission.REMOTE_TERMINAL_ASSIGNMENT_READ),
  )
  const canReadDevice = computed(() =>
    permissionStore.hasPermission(Permission.REMOTE_TERMINAL_DEVICE_MANAGE_READ),
  )
  const canView = computed(
    () => canReadTemplate.value || canReadAssignment.value || canReadDevice.value,
  )

  const visibleTabs = computed<Array<'templates' | 'entitlements' | 'devices'>>(() => {
    const tabs: Array<'templates' | 'entitlements' | 'devices'> = []
    if (canReadTemplate.value) tabs.push('templates')
    if (canReadAssignment.value) tabs.push('entitlements')
    if (canReadDevice.value) tabs.push('devices')
    return tabs
  })

  const canWriteTemplate = computed(() =>
    permissionStore.hasPermission(Permission.REMOTE_TERMINAL_PRODUCT_WRITE),
  )
  const canWriteAssignment = computed(() =>
    permissionStore.hasPermission(Permission.REMOTE_TERMINAL_ASSIGNMENT_WRITE),
  )
  const canWriteToken = computed(() =>
    permissionStore.hasPermission(Permission.REMOTE_TERMINAL_REGISTRATION_TOKEN_WRITE),
  )
  const canWriteDevice = computed(() =>
    permissionStore.hasPermission(Permission.REMOTE_TERMINAL_DEVICE_WRITE),
  )

  const templateDialogTitle = computed(() =>
    editingTemplateId.value
      ? i18ns.t('remoteTerminalProduct.editTemplate')
      : i18ns.t('remoteTerminalProduct.createTemplate'),
  )

  const entitlementDialogTitle = computed(() =>
    editingEntitlementId.value
      ? i18ns.t('remoteTerminalProduct.editEntitlement')
      : i18ns.t('remoteTerminalProduct.assignEntitlement'),
  )

  const formatDateTime = (value?: string) => {
    if (!value) return '-'
    const time = new Date(value)
    if (Number.isNaN(time.getTime())) return value
    return time.toLocaleString()
  }

  const formatTemplatePurchaseLimit = (row: RemoteTerminalProductTemplateDto) => {
    if (!row.purchaseLimitPerUser || !row.purchaseLimitWindowDays) {
      return i18ns.t('remoteTerminalProduct.unlimitedPurchase')
    }

    return i18ns.t('remoteTerminalProduct.purchaseLimitValue', {
      count: row.purchaseLimitPerUser,
      days: row.purchaseLimitWindowDays,
    })
  }

  const hasDeviceQuota = (deviceLimit?: number) => Number(deviceLimit || 0) > 0

  const resetTemplateForm = () => {
    editingTemplateId.value = undefined
    templateForm.name = ''
    templateForm.description = ''
    templateForm.billingUnit = 'day'
    templateForm.minimumPurchaseUnits = 1
    templateForm.maximumPurchaseUnits = undefined
    templateForm.devicePrice = undefined
    templateForm.terminalPrice = undefined
    templateForm.currency = '曲'
    templateForm.purchaseLimitPerUser = undefined
    templateForm.purchaseLimitWindowDays = undefined
    templateForm.minimumDeviceCount = undefined
    templateForm.minimumTerminalCount = undefined
    templateForm.maxDeviceCount = undefined
    templateForm.maxTerminalCount = undefined
    templateFormRef.value?.clearValidate()
  }

  const resetEntitlementForm = () => {
    editingEntitlementId.value = undefined
    entitlementForm.userId = ''
    entitlementForm.templateId = ''
    entitlementForm.name = ''
    entitlementForm.description = ''
    entitlementForm.startAt = ''
    entitlementForm.endAt = ''
    entitlementForm.deviceLimit = 1
    entitlementForm.terminalLimit = 1
    entitlementForm.maxDeviceCount = undefined
    entitlementForm.maxTerminalCount = undefined
    entitlementForm.note = ''
    entitlementFormRef.value?.clearValidate()
  }

  const loadUserOptions = async (keyword?: string) => {
    userOptionsLoading.value = true
    try {
      const result = await userService.getAllUsers({
        page: 1,
        pageSize: USER_OPTIONS_PAGE_SIZE,
        keyword: keyword?.trim() || undefined,
      })
      const users = Array.isArray(result?.users) ? result.users : []
      userOptions.value = users
        .map((item: { id: string; username?: string }) => ({
          id: item.id,
          username: item.username || item.id,
        }))
        .sort((a, b) => a.username.localeCompare(b.username))
    } catch {
      userOptions.value = []
    } finally {
      userOptionsLoading.value = false
    }
  }

  const ensureUserOption = (userId?: string, username?: string | null) => {
    if (!userId) return
    if (userOptions.value.some((item) => item.id === userId)) return
    userOptions.value = [{ id: userId, username: username || userId }, ...userOptions.value]
  }

  const handleUserSearch = (query: string) => {
    void loadUserOptions(query)
  }

  const loadFilterOptions = async () => {
    if (!canView.value) {
      filterOptions.templateStatusOptions = []
      filterOptions.assignmentStatusOptions = []
      filterOptions.deviceStatusOptions = []
      filterOptions.publishStatusOptions = []
      filterOptions.templates = []
      return
    }

    const result = await remoteTerminalProductService.getFilterOptions()
    filterOptions.templateStatusOptions = result.templateStatusOptions || []
    filterOptions.assignmentStatusOptions = result.assignmentStatusOptions || []
    filterOptions.deviceStatusOptions = result.deviceStatusOptions || []
    filterOptions.publishStatusOptions = result.publishStatusOptions || []
    filterOptions.templates = result.templates || []
  }

  const loadTemplates = async () => {
    if (!canReadTemplate.value) {
      templates.value = []
      return
    }

    const result = await remoteTerminalProductService.listTemplates({
      page: 1,
      pageSize: 100,
      keyword: templateKeyword.value.trim() || undefined,
      status: templateStatus.value,
    })
    templates.value = result.records || []
  }

  const loadEntitlements = async () => {
    if (!canReadAssignment.value) {
      entitlements.value = []
      return
    }

    const result = await remoteTerminalProductService.listEntitlements({
      page: 1,
      pageSize: 100,
      userId: entitlementFilter.userId,
      templateId: entitlementFilter.templateId,
      status: entitlementFilter.status,
    })
    entitlements.value = result.records || []
    entitlements.value.forEach((item) => ensureUserOption(item.userId, item.username))
  }

  const loadDevices = async () => {
    if (!canReadDevice.value) {
      devices.value = []
      return
    }

    const result = await remoteTerminalProductService.listDevices({
      page: 1,
      pageSize: 100,
      userId: deviceFilter.userId,
      entitlementId: deviceFilter.entitlementId,
      status: deviceFilter.status,
    })
    devices.value = result.records || []
    devices.value.forEach((item) => ensureUserOption(item.userId, item.username))
  }

  const refreshAll = async () => {
    if (!canView.value) return
    loading.value = true
    try {
      await Promise.all([
        loadFilterOptions(),
        canReadAssignment.value || canReadDevice.value ? loadUserOptions() : Promise.resolve(),
      ])
      await Promise.all([
        canReadTemplate.value ? loadTemplates() : Promise.resolve(),
        canReadAssignment.value ? loadEntitlements() : Promise.resolve(),
        canReadDevice.value ? loadDevices() : Promise.resolve(),
      ])
    } catch (error) {
      ElMessage.error(toErrorMessage(error, i18ns.t('remoteTerminalProduct.refreshFailed')))
    } finally {
      loading.value = false
    }
  }

  const openCreateTemplateDialog = () => {
    resetTemplateForm()
    templateDialogVisible.value = true
  }

  const openEditTemplateDialog = (row: RemoteTerminalProductTemplateDto) => {
    editingTemplateId.value = row.id
    templateForm.name = row.name
    templateForm.description = row.description || ''
    templateForm.billingUnit = row.billingUnit
    templateForm.minimumPurchaseUnits = row.minimumPurchaseUnits
    templateForm.maximumPurchaseUnits = row.maximumPurchaseUnits ?? undefined
    templateForm.devicePrice = row.devicePrice ?? undefined
    templateForm.terminalPrice = row.terminalPrice ?? undefined
    templateForm.currency = row.currency || '曲'
    templateForm.purchaseLimitPerUser = row.purchaseLimitPerUser ?? undefined
    templateForm.purchaseLimitWindowDays = row.purchaseLimitWindowDays ?? undefined
    templateForm.minimumDeviceCount = row.minimumDeviceCount ?? undefined
    templateForm.minimumTerminalCount = row.minimumTerminalCount ?? undefined
    templateForm.maxDeviceCount = row.maxDeviceCount ?? undefined
    templateForm.maxTerminalCount = row.maxTerminalCount ?? undefined
    templateDialogVisible.value = true
  }

  const submitTemplateDialog = async () => {
    if (!templateFormRef.value) return
    dialogSubmitting.value = true
    try {
      await templateFormRef.value.validate()

      const payload = {
        name: templateForm.name.trim(),
        description: templateForm.description.trim() || undefined,
        billingUnit: templateForm.billingUnit,
        minimumPurchaseUnits: Number(templateForm.minimumPurchaseUnits || 1),
        maximumPurchaseUnits: templateForm.maximumPurchaseUnits ?? null,
        devicePrice: templateForm.devicePrice ?? null,
        terminalPrice: templateForm.terminalPrice ?? null,
        currency: templateForm.currency.trim() || '曲',
        purchaseLimitPerUser: templateForm.purchaseLimitPerUser ?? null,
        purchaseLimitWindowDays: templateForm.purchaseLimitWindowDays ?? null,
        minimumDeviceCount: templateForm.minimumDeviceCount ?? null,
        minimumTerminalCount: templateForm.minimumTerminalCount ?? null,
        maxDeviceCount: templateForm.maxDeviceCount ?? null,
        maxTerminalCount: templateForm.maxTerminalCount ?? null,
      }

      if (editingTemplateId.value) {
        await remoteTerminalProductService.updateTemplate(editingTemplateId.value, payload)
      } else {
        await remoteTerminalProductService.createTemplate(payload)
      }

      ElMessage.success(
        editingTemplateId.value ? i18ns.t('updateSuccess') : i18ns.t('createSuccess'),
      )
      templateDialogVisible.value = false
      await refreshAll()
    } catch (error) {
      ElMessage.error(toErrorMessage(error, i18ns.t('remoteTerminalProduct.saveFailed')))
    } finally {
      dialogSubmitting.value = false
    }
  }

  const handlePublish = async (id: string) => {
    try {
      await remoteTerminalProductService.publishTemplate(id)
      ElMessage.success(i18ns.t('updateSuccess'))
      await refreshAll()
    } catch (error) {
      ElMessage.error(toErrorMessage(error, i18ns.t('remoteTerminalProduct.publishFailed')))
    }
  }

  const handleUnpublish = async (id: string) => {
    try {
      await remoteTerminalProductService.unpublishTemplate(id)
      ElMessage.success(i18ns.t('updateSuccess'))
      await refreshAll()
    } catch (error) {
      ElMessage.error(toErrorMessage(error, i18ns.t('remoteTerminalProduct.unpublishFailed')))
    }
  }

  const handleDeleteTemplate = async (id: string) => {
    try {
      await ElMessageBox.confirm(i18ns.t('confirmDelete'), i18ns.t('warning'), { type: 'warning' })
      await remoteTerminalProductService.deleteTemplate(id)
      ElMessage.success(i18ns.t('deleteSuccess'))
      await refreshAll()
    } catch (error) {
      if (error === 'cancel' || error === 'close') return
      ElMessage.error(toErrorMessage(error, i18ns.t('remoteTerminalProduct.deleteFailed')))
    }
  }

  const openAssignEntitlementDialog = () => {
    resetEntitlementForm()
    entitlementDialogVisible.value = true
  }

  const openEditEntitlementDialog = (row: RemoteTerminalUserEntitlementDto) => {
    editingEntitlementId.value = row.id
    entitlementForm.userId = row.userId
    entitlementForm.templateId = row.templateId || ''
    entitlementForm.name = row.name
    entitlementForm.description = row.description || ''
    entitlementForm.startAt = row.startAt
    entitlementForm.endAt = row.endAt
    entitlementForm.deviceLimit = row.deviceLimit
    entitlementForm.terminalLimit = row.terminalLimit
    entitlementForm.maxDeviceCount = row.maxDeviceCount ?? undefined
    entitlementForm.maxTerminalCount = row.maxTerminalCount ?? undefined
    entitlementForm.note = row.note || ''
    ensureUserOption(row.userId, row.username)
    entitlementDialogVisible.value = true
  }

  const submitEntitlementDialog = async () => {
    if (!entitlementFormRef.value) return
    dialogSubmitting.value = true
    try {
      await entitlementFormRef.value.validate()

      const normalizedStartAt = entitlementForm.startAt.trim()
      const normalizedEndAt = entitlementForm.endAt.trim()

      if (editingEntitlementId.value) {
        await remoteTerminalProductService.updateEntitlement(editingEntitlementId.value, {
          name: entitlementForm.name.trim() || undefined,
          description: entitlementForm.description.trim() || undefined,
          ...(normalizedStartAt ? { startAt: normalizedStartAt } : {}),
          ...(normalizedEndAt ? { endAt: normalizedEndAt } : {}),
          deviceLimit: Number(entitlementForm.deviceLimit),
          terminalLimit: Number(entitlementForm.terminalLimit),
          maxDeviceCount: entitlementForm.maxDeviceCount ?? null,
          maxTerminalCount: entitlementForm.maxTerminalCount ?? null,
          note: entitlementForm.note.trim() || undefined,
        })
      } else {
        await remoteTerminalProductService.assignEntitlement({
          userId: entitlementForm.userId,
          templateId: entitlementForm.templateId || undefined,
          name: entitlementForm.name.trim() || undefined,
          description: entitlementForm.description.trim() || undefined,
          startAt: normalizedStartAt,
          endAt: normalizedEndAt,
          deviceLimit: Number(entitlementForm.deviceLimit),
          terminalLimit: Number(entitlementForm.terminalLimit),
          note: entitlementForm.note.trim() || undefined,
        })
      }

      ElMessage.success(
        editingEntitlementId.value ? i18ns.t('updateSuccess') : i18ns.t('createSuccess'),
      )
      entitlementDialogVisible.value = false
      await refreshAll()
    } catch (error) {
      ElMessage.error(toErrorMessage(error, i18ns.t('remoteTerminalProduct.saveFailed')))
    } finally {
      dialogSubmitting.value = false
    }
  }

  const handleDeleteEntitlement = async (id: string) => {
    try {
      await ElMessageBox.confirm(i18ns.t('confirmDelete'), i18ns.t('warning'), { type: 'warning' })
      await remoteTerminalProductService.deleteEntitlement(id)
      ElMessage.success(i18ns.t('deleteSuccess'))
      await refreshAll()
    } catch (error) {
      if (error === 'cancel' || error === 'close') return
      ElMessage.error(toErrorMessage(error, i18ns.t('remoteTerminalProduct.deleteFailed')))
    }
  }

  const openRotateTokenDialog = (row: RemoteTerminalUserEntitlementDto) => {
    if (!hasDeviceQuota(row.deviceLimit)) return
    tokenEntitlementId.value = row.id
    tokenForm.label = row.registrationToken?.label || ''
    tokenForm.expiresAt = row.registrationToken?.expiresAt || ''
    tokenDialogVisible.value = true
  }

  const submitRotateToken = async () => {
    if (!tokenEntitlementId.value) return
    dialogSubmitting.value = true
    try {
      await remoteTerminalProductService.rotateRegistrationToken(tokenEntitlementId.value, {
        label: tokenForm.label.trim() || null,
        expiresAt: tokenForm.expiresAt || null,
      })
      ElMessage.success(i18ns.t('updateSuccess'))
      tokenDialogVisible.value = false
      await refreshAll()
    } catch (error) {
      ElMessage.error(toErrorMessage(error, i18ns.t('remoteTerminalProduct.tokenRotateFailed')))
    } finally {
      dialogSubmitting.value = false
    }
  }

  const openLimitAdjustDialog = (row: RemoteTerminalUserEntitlementDto) => {
    limitAdjustTarget.value = row
    limitAdjustForm.deviceLimit = row.deviceLimit
    limitAdjustForm.terminalLimit = row.terminalLimit
    limitAdjustForm.maxDeviceCount = row.maxDeviceCount ?? undefined
    limitAdjustForm.maxTerminalCount = row.maxTerminalCount ?? undefined
    limitAdjustDialogVisible.value = true
  }

  const submitLimitAdjustDialog = async () => {
    if (!limitAdjustTarget.value) return
    dialogSubmitting.value = true
    try {
      await remoteTerminalProductService.updateEntitlement(limitAdjustTarget.value.id, {
        deviceLimit: Number(limitAdjustForm.deviceLimit),
        terminalLimit: Number(limitAdjustForm.terminalLimit),
        maxDeviceCount: limitAdjustForm.maxDeviceCount ?? null,
        maxTerminalCount: limitAdjustForm.maxTerminalCount ?? null,
      })
      ElMessage.success(i18ns.t('updateSuccess'))
      limitAdjustDialogVisible.value = false
      limitAdjustTarget.value = undefined
      await refreshAll()
    } catch (error) {
      ElMessage.error(toErrorMessage(error, i18ns.t('remoteTerminalProduct.saveFailed')))
    } finally {
      dialogSubmitting.value = false
    }
  }

  const handleResetUnbindCount = async () => {
    if (!limitAdjustTarget.value) return
    resettingUnbind.value = true
    try {
      await ElMessageBox.confirm(
        i18ns.t('remoteTerminalProduct.resetUnbindConfirm'),
        i18ns.t('warning'),
        { type: 'warning' },
      )
      await remoteTerminalProductService.resetUnbindCount(limitAdjustTarget.value.id)
      ElMessage.success(i18ns.t('updateSuccess'))
      await refreshAll()
    } catch (error) {
      if (error === 'cancel' || error === 'close') return
      ElMessage.error(toErrorMessage(error, i18ns.t('remoteTerminalProduct.resetUnbindFailed')))
    } finally {
      resettingUnbind.value = false
    }
  }

  const handleRevokeDevice = async (id: string) => {
    try {
      await ElMessageBox.confirm(i18ns.t('confirmDelete'), i18ns.t('warning'), { type: 'warning' })
      await remoteTerminalProductService.revokeDevice(id)
      ElMessage.success(i18ns.t('deleteSuccess'))
      await refreshAll()
    } catch (error) {
      if (error === 'cancel' || error === 'close') return
      ElMessage.error(toErrorMessage(error, i18ns.t('remoteTerminalProduct.revokeFailed')))
    }
  }

  watch([templateKeyword, templateStatus], () => {
    if (!canReadTemplate.value) return
    void loadTemplates()
  })

  watch(
    () => [entitlementFilter.userId, entitlementFilter.templateId, entitlementFilter.status],
    () => {
      if (!canReadAssignment.value) return
      void loadEntitlements()
    },
  )

  watch(
    () => [deviceFilter.userId, deviceFilter.entitlementId, deviceFilter.status],
    () => {
      if (!canReadDevice.value) return
      void loadDevices()
    },
  )

  watch(
    visibleTabs,
    (tabs) => {
      if (!tabs.includes(activeTab.value)) {
        activeTab.value = tabs[0] ?? 'templates'
      }
    },
    { immediate: true },
  )

  onMounted(async () => {
    await permissionService.ensureLoaded()
    await refreshAll()
  })

  return {
    activeTab,
    canReadAssignment,
    canReadDevice,
    canReadTemplate,
    canView,
    canWriteAssignment,
    canWriteDevice,
    canWriteTemplate,
    canWriteToken,
    deviceFilter,
    devices,
    dialogSubmitting,
    editingEntitlementId,
    editingTemplateId,
    entitlementDialogTitle,
    entitlementDialogVisible,
    entitlementFilter,
    entitlementForm,
    entitlementFormRef,
    entitlementFormRules,
    entitlements,
    filterOptions,
    formatBillingUnitLabel,
    formatDateTime,
    formatPrice,
    formatTemplatePurchaseLimit,
    formatUnitPrice,
    handleDeleteEntitlement,
    handleDeleteTemplate,
    handlePublish,
    handleResetUnbindCount,
    handleRevokeDevice,
    handleUnpublish,
    handleUserSearch,
    hasDeviceQuota,
    limitAdjustDialogVisible,
    limitAdjustForm,
    limitAdjustFormRef,
    limitAdjustTarget,
    loadDevices,
    loadEntitlements,
    loading,
    openAssignEntitlementDialog,
    openCreateTemplateDialog,
    openEditEntitlementDialog,
    openEditTemplateDialog,
    openLimitAdjustDialog,
    openRotateTokenDialog,
    refreshAll,
    resetEntitlementForm,
    resetTemplateForm,
    resettingUnbind,
    submitEntitlementDialog,
    submitLimitAdjustDialog,
    submitRotateToken,
    submitTemplateDialog,
    supportsDevice,
    supportsTerminal,
    templateDialogTitle,
    templateDialogVisible,
    templateForm,
    templateFormRef,
    templateFormRules,
    templateKeyword,
    templateStatus,
    templates,
    tokenDialogVisible,
    tokenEntitlementId,
    tokenForm,
    userOptions,
    userOptionsLoading,
    visibleTabs,
  }
}

export type RemoteTerminalProductManagementState = ReturnType<
  typeof useRemoteTerminalProductManagement
>
