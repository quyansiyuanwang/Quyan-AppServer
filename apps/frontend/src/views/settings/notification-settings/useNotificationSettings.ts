import { computed, onMounted, reactive, ref } from 'vue'
import { CircleCheck, CircleClose, Plus, Refresh } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type {
  NotificationEventInfoDto,
  NotificationInboxItemDto,
  NotificationLogDto,
  NotificationWebhookDto,
} from '@/client/types.gen'
import { usePageDevice } from '@/composables/usePageDevice'
import { i18ns } from '@/locales'
import { NotificationService } from '@/service/notificationService'
import {
  getNotificationEventLabel,
  getNotificationThresholdUnit,
} from '@/utils/notification-event-i18n'

export const useNotificationSettings = () => {
  const service = NotificationService.getInstance()
  const { isDesktop } = usePageDevice()

  const loadingPrefs = ref(false)
  const savingPrefs = ref(false)
  const testingEmail = ref(false)
  const emailTestResult = ref<boolean | null>(null)
  const emailTestResultError = ref('')

  const prefForm = reactive<{
    notificationEmail: string
    cooldownMinutes: number
    thresholds: Record<string, number>
  }>({
    notificationEmail: '',
    cooldownMinutes: 60,
    thresholds: {},
  })

  const subscribedSet = reactive<Record<string, boolean>>({})

  const selectAllEvents = () => {
    for (const ev of eventList.value) {
      subscribedSet[ev.value] = true
    }
  }

  const clearAllEvents = () => {
    for (const ev of eventList.value) {
      subscribedSet[ev.value] = false
    }
  }

  const loadingEvents = ref(false)
  const eventList = ref<NotificationEventInfoDto[]>([])

  const thresholdEvents = computed(() =>
    eventList.value.filter((ev) => ev.hasThreshold && subscribedSet[ev.value]),
  )

  const loadEventList = async () => {
    loadingEvents.value = true
    try {
      const res = await service.getEventList()
      eventList.value = (res.data ?? []) as NotificationEventInfoDto[]
    } catch {
      // ignore
    } finally {
      loadingEvents.value = false
    }
  }

  const loadPreferences = async () => {
    loadingPrefs.value = true
    try {
      const res = await service.getPreferences()
      const data = res.data
      prefForm.notificationEmail = data.notificationEmail ?? ''
      prefForm.cooldownMinutes = data.cooldownMinutes ?? 60
      prefForm.thresholds = { ...(data.thresholds ?? {}) }
      for (const key of Object.keys(subscribedSet)) {
        subscribedSet[key] = false
      }
      const validEventValues = new Set(eventList.value.map((ev) => ev.value))
      for (const ev of (data.subscribedEvents ?? []) as string[]) {
        if (validEventValues.has(ev)) subscribedSet[ev] = true
      }
    } catch {
      // ignore
    } finally {
      loadingPrefs.value = false
    }
  }

  const handleTestEmail = async () => {
    testingEmail.value = true
    emailTestResult.value = null
    emailTestResultError.value = ''
    try {
      const res = await service.testEmail()
      emailTestResult.value = res.data?.success ?? false
      emailTestResultError.value = res.data?.error ?? ''
    } catch {
      emailTestResult.value = false
      emailTestResultError.value = i18ns.t('NotificationSettingsView.webhookTestFailed')
    } finally {
      testingEmail.value = false
    }
  }

  const savePreferences = async () => {
    savingPrefs.value = true
    try {
      const validEventValues = new Set(eventList.value.map((ev) => ev.value))
      const subscribedEvents = Object.entries(subscribedSet)
        .filter(([key, checked]) => checked && validEventValues.has(key))
        .map(([key]) => key)

      const thresholds: Record<string, number> = {}
      for (const ev of thresholdEvents.value) {
        const val = prefForm.thresholds[ev.value]
        if (val !== undefined) {
          thresholds[ev.value] = val
        }
      }

      await service.updatePreferences({
        notificationEmail: prefForm.notificationEmail || null,
        subscribedEvents,
        thresholds,
        cooldownMinutes: prefForm.cooldownMinutes,
      })
      ElMessage.success(i18ns.t('NotificationSettingsView.preferenceSaved'))
    } catch {
      // error handled by interceptor
    } finally {
      savingPrefs.value = false
    }
  }

  const loadingWebhooks = ref(false)
  const webhooks = ref<NotificationWebhookDto[]>([])
  const webhookDialogVisible = ref(false)
  const savingWebhook = ref(false)
  const editingWebhook = ref<NotificationWebhookDto | null>(null)
  const testingWebhook = ref(false)
  const testResult = ref<boolean | null>(null)
  const testResultError = ref('')
  const testResultIcon = computed(() => {
    if (testResult.value === true) return CircleCheck
    if (testResult.value === false) return CircleClose
    return undefined
  })

  const webhookForm = reactive({
    name: '',
    url: '',
    format: 'generic',
    secret: '',
    enabled: true,
  })

  const webhookFormats = computed(() => [
    { value: 'generic', label: i18ns.t('NotificationSettingsView.formats.generic') },
    { value: 'discord', label: i18ns.t('NotificationSettingsView.formats.discord') },
    { value: 'slack', label: i18ns.t('NotificationSettingsView.formats.slack') },
    { value: 'feishu', label: i18ns.t('NotificationSettingsView.formats.feishu') },
    { value: 'wechat_work', label: i18ns.t('NotificationSettingsView.formats.wechat_work') },
  ])

  const formatLabel = (fmt: string) => {
    const found = webhookFormats.value.find((item) => item.value === fmt)
    return found?.label ?? fmt
  }

  const loadWebhooks = async () => {
    loadingWebhooks.value = true
    try {
      const res = await service.listWebhooks()
      webhooks.value = (res.data ?? []) as NotificationWebhookDto[]
    } catch {
      // ignore
    } finally {
      loadingWebhooks.value = false
    }
  }

  const openWebhookDialog = (row: NotificationWebhookDto | null) => {
    editingWebhook.value = row
    testResult.value = null
    testResultError.value = ''
    if (row) {
      webhookForm.name = row.name
      webhookForm.url = row.url
      webhookForm.format = row.format
      webhookForm.secret = ''
      webhookForm.enabled = row.enabled
    } else {
      webhookForm.name = ''
      webhookForm.url = ''
      webhookForm.format = 'generic'
      webhookForm.secret = ''
      webhookForm.enabled = true
    }
    webhookDialogVisible.value = true
  }

  const closeWebhookDialog = () => {
    webhookDialogVisible.value = false
  }

  const submitWebhookDialog = async () => {
    if (!webhookForm.name.trim() || !webhookForm.url.trim()) return
    savingWebhook.value = true
    try {
      if (editingWebhook.value) {
        await service.updateWebhook(editingWebhook.value.id, {
          name: webhookForm.name,
          url: webhookForm.url,
          format: webhookForm.format,
          secret: webhookForm.secret || null,
          enabled: webhookForm.enabled,
        })
        ElMessage.success(i18ns.t('NotificationSettingsView.webhookUpdated'))
      } else {
        await service.createWebhook({
          name: webhookForm.name,
          url: webhookForm.url,
          format: webhookForm.format,
          secret: webhookForm.secret || null,
          enabled: webhookForm.enabled,
        })
        ElMessage.success(i18ns.t('NotificationSettingsView.webhookCreated'))
      }
      closeWebhookDialog()
      await loadWebhooks()
    } catch {
      // error handled by interceptor
    } finally {
      savingWebhook.value = false
    }
  }

  const handleTestWebhook = async (row: NotificationWebhookDto) => {
    try {
      const res = await service.testWebhook(row.id)
      if (res.data?.success) {
        ElMessage.success(i18ns.t('NotificationSettingsView.webhookTestSuccess'))
      } else {
        ElMessage.error(res.data?.error || i18ns.t('NotificationSettingsView.webhookTestFailed'))
      }
    } catch {
      ElMessage.error(i18ns.t('NotificationSettingsView.webhookTestFailed'))
    }
  }

  const handleTestWebhookInDialog = async () => {
    if (!editingWebhook.value) return
    testingWebhook.value = true
    testResult.value = null
    testResultError.value = ''
    try {
      const res = await service.testWebhook(editingWebhook.value.id)
      testResult.value = res.data?.success ?? false
      testResultError.value = res.data?.error ?? ''
    } catch {
      testResult.value = false
      testResultError.value = i18ns.t('NotificationSettingsView.webhookTestFailed')
    } finally {
      testingWebhook.value = false
    }
  }

  const handleDeleteWebhook = async (row: NotificationWebhookDto) => {
    try {
      await ElMessageBox.confirm(
        i18ns.t('NotificationSettingsView.confirmDeleteWebhook'),
        i18ns.t('confirm'),
        { type: 'warning' },
      )
      await service.deleteWebhook(row.id)
      ElMessage.success(i18ns.t('NotificationSettingsView.webhookDeleted'))
      await loadWebhooks()
    } catch {
      // cancelled or error
    }
  }

  const loadingLogs = ref(false)
  const logs = ref<NotificationLogDto[]>([])
  const logTotal = ref(0)
  const logPage = ref(1)
  const logPageSize = ref(20)

  const loadingInbox = ref(false)
  const markingInboxRead = ref(false)
  const markingInboxReadSingleId = ref('')
  const confirmingPixelRead = ref(false)
  const inboxItems = ref<NotificationInboxItemDto[]>([])
  const inboxTotal = ref(0)
  const inboxUnreadCount = ref(0)
  const inboxPixelOpenedUnreadCount = ref(0)
  const inboxPage = ref(1)
  const inboxPageSize = ref(20)
  const inboxUnreadOnly = ref(false)

  const loadInbox = async () => {
    loadingInbox.value = true
    try {
      const res = await service.getInbox(inboxPage.value, inboxPageSize.value, inboxUnreadOnly.value)
      inboxItems.value = (res.data?.items ?? []) as NotificationInboxItemDto[]
      inboxTotal.value = (res.data?.total ?? 0) as number
      inboxUnreadCount.value = (res.data?.unreadCount ?? 0) as number
      inboxPixelOpenedUnreadCount.value = (res.data?.pixelOpenedUnreadCount ?? 0) as number
    } catch {
      // ignore
    } finally {
      loadingInbox.value = false
    }
  }

  const confirmPixelOpenedRead = async () => {
    confirmingPixelRead.value = true
    try {
      const res = await service.confirmPixelOpenedRead()
      ElMessage.success(
        i18ns.t('NotificationSettingsView.confirmPixelReadSuccess', {
          count: res.data?.count ?? 0,
        }),
      )
      await loadInbox()
    } catch {
      // error handled by interceptor
    } finally {
      confirmingPixelRead.value = false
    }
  }

  const markInboxItemRead = async (id: string) => {
    markingInboxReadSingleId.value = id
    try {
      await service.markInboxRead({ ids: [id] })
      await loadInbox()
    } catch {
      // error handled by interceptor
    } finally {
      markingInboxReadSingleId.value = ''
    }
  }

  const markAllInboxRead = async () => {
    markingInboxRead.value = true
    try {
      await service.markInboxRead({ markAll: true })
      await loadInbox()
    } catch {
      // error handled by interceptor
    } finally {
      markingInboxRead.value = false
    }
  }

  const onInboxPageChange = (page: number) => {
    inboxPage.value = page
    void loadInbox()
  }

  const onInboxFilterChange = () => {
    inboxPage.value = 1
    void loadInbox()
  }

  const loadLogs = async () => {
    loadingLogs.value = true
    try {
      const res = await service.getLogs(logPage.value, logPageSize.value)
      logs.value = (res.data?.logs ?? []) as NotificationLogDto[]
      logTotal.value = (res.data?.total ?? 0) as number
    } catch {
      // ignore
    } finally {
      loadingLogs.value = false
    }
  }

  const onLogPageChange = (page: number) => {
    logPage.value = page
    void loadLogs()
  }

  const eventLabel = (eventType: string) => getNotificationEventLabel(eventType)
  const getEventDisplayLabel = (eventType: string) => getNotificationEventLabel(eventType)
  const getThresholdUnitLabel = (eventType: string) => getNotificationThresholdUnit(eventType)

  const statusLabel = (status: string) => {
    if (status === 'success') return i18ns.t('NotificationSettingsView.statusSuccess')
    if (status === 'failed') return i18ns.t('NotificationSettingsView.statusFailed')
    return i18ns.t('NotificationSettingsView.statusPending')
  }

  const statusTagType = (status: string): 'success' | 'danger' | 'warning' => {
    if (status === 'success') return 'success'
    if (status === 'failed') return 'danger'
    return 'warning'
  }

  onMounted(async () => {
    await loadEventList()
    await Promise.all([loadPreferences(), loadWebhooks(), loadInbox(), loadLogs()])
  })

  return {
    i18ns,
    isDesktop,
    Plus,
    Refresh,
    loadingPrefs,
    savingPrefs,
    testingEmail,
    emailTestResult,
    emailTestResultError,
    prefForm,
    subscribedSet,
    selectAllEvents,
    clearAllEvents,
    loadingEvents,
    eventList,
    thresholdEvents,
    loadEventList,
    loadPreferences,
    handleTestEmail,
    savePreferences,
    loadingWebhooks,
    webhooks,
    webhookDialogVisible,
    savingWebhook,
    editingWebhook,
    testingWebhook,
    testResult,
    testResultError,
    testResultIcon,
    webhookForm,
    webhookFormats,
    formatLabel,
    loadWebhooks,
    openWebhookDialog,
    closeWebhookDialog,
    submitWebhookDialog,
    handleTestWebhook,
    handleTestWebhookInDialog,
    handleDeleteWebhook,
    loadingLogs,
    logs,
    logTotal,
    logPage,
    logPageSize,
    loadingInbox,
    markingInboxRead,
    markingInboxReadSingleId,
    confirmingPixelRead,
    inboxItems,
    inboxTotal,
    inboxUnreadCount,
    inboxPixelOpenedUnreadCount,
    inboxPage,
    inboxPageSize,
    inboxUnreadOnly,
    loadInbox,
    confirmPixelOpenedRead,
    markInboxItemRead,
    markAllInboxRead,
    onInboxPageChange,
    onInboxFilterChange,
    loadLogs,
    onLogPageChange,
    eventLabel,
    getEventDisplayLabel,
    getThresholdUnitLabel,
    statusLabel,
    statusTagType,
  }
}

export type NotificationSettingsState = ReturnType<typeof useNotificationSettings>
