import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useI18n } from 'vue-i18n'
import { usePageDevice } from '@/composables/usePageDevice'
import { i18ns } from '@/locales'
import { AuthCenterClientService } from '@/service/authCenterClientService'
import { CustomCode } from '@/constant/custom-code'
import type {
  AuthCenterClientDto,
  AuthCenterClientReviewStatus,
  AuthCenterGrantType,
  CreateAuthCenterClientDto,
  UpdateAuthCenterClientDto,
} from '@/client/types.gen'

export type AuthCenterClientFormState = {
  name: string
  description: string
  clientType: 'confidential' | 'public'
  grantTypes: AuthCenterGrantType[]
  redirectUris: string[]
  scopes: string[]
  isPkceRequired: boolean
  accessTokenLifetime: number
  refreshTokenLifetime: number
  homepageUrl: string
  logoUrl: string
  policyUrl: string
  tosUrl: string
}

const createEmptyForm = (): AuthCenterClientFormState => ({
  name: '',
  description: '',
  clientType: 'confidential',
  grantTypes: ['authorization_code', 'refresh_token', 'client_credentials'],
  redirectUris: [],
  scopes: ['profile'],
  isPkceRequired: true,
  accessTokenLifetime: 3600,
  refreshTokenLifetime: 2592000,
  homepageUrl: '',
  logoUrl: '',
  policyUrl: '',
  tosUrl: '',
})

export const useAuthCenterClientManagement = () => {
  const { isDesktop } = usePageDevice()
  const { t } = useI18n()
  const authCenterClientService = AuthCenterClientService.getInstance()

  const clients = ref<AuthCenterClientDto[]>([])
  const loading = ref(false)
  const submitting = ref(false)
  const showFormDialog = ref(false)
  const showSecretDialog = ref(false)
  const isEditing = ref(false)
  const editingId = ref('')
  const createdSecret = ref('')
  const form = ref<AuthCenterClientFormState>(createEmptyForm())

  const isPkceLocked = computed(
    () =>
      form.value.clientType === 'public' &&
      form.value.grantTypes.includes('authorization_code'),
  )

  const grantTypeOptions = computed(() => [
    {
      value: 'authorization_code' as const,
      label: i18ns.t('authCenterClient.grantTypeLabels.authorization_code'),
      description: i18ns.t('authCenterClient.grantTypeDescriptions.authorization_code'),
      note: i18ns.t('authCenterClient.grantTypeNotes.authorization_code'),
      disabled: false,
    },
    {
      value: 'refresh_token' as const,
      label: i18ns.t('authCenterClient.grantTypeLabels.refresh_token'),
      description: i18ns.t('authCenterClient.grantTypeDescriptions.refresh_token'),
      note: i18ns.t('authCenterClient.grantTypeNotes.refresh_token'),
      disabled: false,
    },
    {
      value: 'client_credentials' as const,
      label: i18ns.t('authCenterClient.grantTypeLabels.client_credentials'),
      description: i18ns.t('authCenterClient.grantTypeDescriptions.client_credentials'),
      note: i18ns.t('authCenterClient.grantTypeNotes.client_credentials'),
      disabled: form.value.clientType === 'public',
    },
  ])

  const scopeOptions = computed(() => [
    {
      value: 'profile',
      label: i18ns.t('authCenterClient.scopeOptionTitles.profile'),
      description: i18ns.t('authCenterClient.scopeDescriptions.profile'),
    },
  ])

  const grantTypeRows = computed(() =>
    grantTypeOptions.value.map((item) => ({
      grantType: item.value,
      description: item.description,
      tokenBehavior: i18ns.t(`authCenterClient.tokenBehavior.${item.value}`),
      notes: item.note,
    })),
  )

  const getReviewStatusLabel = (status: AuthCenterClientReviewStatus) =>
    i18ns.t(`authCenterClient.reviewStatuses.${status}`)

  const getReviewStatusTagType = (status: AuthCenterClientReviewStatus) => {
    switch (status) {
      case 'approved':
        return 'success'
      case 'rejected':
        return 'danger'
      case 'pending':
        return 'warning'
      default:
        return 'info'
    }
  }

  const canSubmitReview = (status: AuthCenterClientReviewStatus) =>
    status === 'draft' || status === 'rejected'

  const getClientTypeLabel = (clientType: AuthCenterClientDto['clientType']) =>
    clientType === 'public'
      ? i18ns.t('authCenterClient.type.public')
      : i18ns.t('authCenterClient.type.confidential')

  const getGrantTypeLabel = (grantType: AuthCenterGrantType) =>
    i18ns.t(`authCenterClient.grantTypeLabels.${grantType}`)

  const normalizeStringArray = (value: string[]) => value.map((item) => item.trim()).filter(Boolean)

  const normalizeOptionalString = (value: string) => {
    const trimmed = value.trim()
    return trimmed ? trimmed : null
  }

  const formatLifetime = (seconds: number) => `${seconds}s`

  const syncClientTypeRules = () => {
    if (form.value.clientType === 'public') {
      const filteredGrantTypes = form.value.grantTypes.filter((item) => item !== 'client_credentials')
      if (filteredGrantTypes.length !== form.value.grantTypes.length) {
        form.value.grantTypes = filteredGrantTypes
      }
    }

    if (
      form.value.clientType === 'public' &&
      form.value.grantTypes.includes('authorization_code') &&
      !form.value.isPkceRequired
    ) {
      form.value.isPkceRequired = true
    }
  }

  watch(
    () => [form.value.clientType, [...form.value.grantTypes].sort().join(',')],
    () => {
      syncClientTypeRules()
    },
  )

  const loadClients = async () => {
    loading.value = true
    try {
      const res = await authCenterClientService.getAuthCenterClients()
      clients.value = res.data
    } catch (error) {
      ElMessage.error(t('authCenterClient.loadFailed'))
      throw error
    } finally {
      loading.value = false
    }
  }

  const resetForm = () => {
    form.value = createEmptyForm()
    editingId.value = ''
    isEditing.value = false
  }

  const addRedirectUriRow = () => {
    form.value.redirectUris.push('')
  }

  const removeRedirectUriRow = (index: number) => {
    form.value.redirectUris.splice(index, 1)
  }

  const openCreateDialog = () => {
    resetForm()
    addRedirectUriRow()
    syncClientTypeRules()
    showFormDialog.value = true
  }

  const openEditDialog = (row: AuthCenterClientDto) => {
    isEditing.value = true
    editingId.value = row.id
    form.value = {
      name: row.name,
      description: row.description || '',
      clientType: row.clientType,
      grantTypes: [...row.grantTypes],
      redirectUris: [...row.redirectUris],
      scopes: [...(row.scopes || [])],
      isPkceRequired: row.isPkceRequired,
      accessTokenLifetime: row.accessTokenLifetime,
      refreshTokenLifetime: row.refreshTokenLifetime,
      homepageUrl: row.homepageUrl || '',
      logoUrl: row.logoUrl || '',
      policyUrl: row.policyUrl || '',
      tosUrl: row.tosUrl || '',
    }
    syncClientTypeRules()
    showFormDialog.value = true
  }

  const buildCreatePayload = (): CreateAuthCenterClientDto => ({
    name: form.value.name.trim(),
    description: form.value.description.trim() || undefined,
    clientType: form.value.clientType,
    grantTypes: [...form.value.grantTypes],
    redirectUris: normalizeStringArray(form.value.redirectUris),
    scopes: [...form.value.scopes],
    isPkceRequired: form.value.isPkceRequired,
    accessTokenLifetime: form.value.accessTokenLifetime,
    refreshTokenLifetime: form.value.refreshTokenLifetime,
    homepageUrl: form.value.homepageUrl.trim() || undefined,
    logoUrl: form.value.logoUrl.trim() || undefined,
    policyUrl: form.value.policyUrl.trim() || undefined,
    tosUrl: form.value.tosUrl.trim() || undefined,
  })

  const buildUpdatePayload = (): UpdateAuthCenterClientDto => ({
    name: form.value.name.trim() || undefined,
    description: normalizeOptionalString(form.value.description),
    clientType: form.value.clientType,
    grantTypes: [...form.value.grantTypes],
    redirectUris: normalizeStringArray(form.value.redirectUris),
    scopes: [...form.value.scopes],
    isPkceRequired: form.value.isPkceRequired,
    accessTokenLifetime: form.value.accessTokenLifetime,
    refreshTokenLifetime: form.value.refreshTokenLifetime,
    homepageUrl: normalizeOptionalString(form.value.homepageUrl),
    logoUrl: normalizeOptionalString(form.value.logoUrl),
    policyUrl: normalizeOptionalString(form.value.policyUrl),
    tosUrl: normalizeOptionalString(form.value.tosUrl),
  })

  const handleSubmit = async () => {
    if (!form.value.name.trim()) {
      ElMessage.warning(t('authCenterClient.nameRequired'))
      return
    }

    if (!form.value.grantTypes.length) {
      ElMessage.warning(t('authCenterClient.grantTypesRequired'))
      return
    }

    if (!form.value.scopes.length) {
      ElMessage.warning(t('authCenterClient.scopesRequired'))
      return
    }

    if (
      form.value.grantTypes.includes('refresh_token') &&
      !form.value.grantTypes.includes('authorization_code')
    ) {
      ElMessage.warning(t('authCenterClient.refreshRequiresAuthorizationCode'))
      return
    }

    if (
      form.value.grantTypes.includes('authorization_code') &&
      !normalizeStringArray(form.value.redirectUris).length
    ) {
      ElMessage.warning(t('authCenterClient.redirectUrisRequired'))
      return
    }

    if (
      form.value.clientType === 'public' &&
      form.value.grantTypes.includes('client_credentials')
    ) {
      ElMessage.warning(t('authCenterClient.publicClientCredentialsNotAllowed'))
      return
    }

    if (form.value.refreshTokenLifetime < form.value.accessTokenLifetime) {
      ElMessage.warning(t('authCenterClient.refreshLifetimeTooShort'))
      return
    }

    try {
      submitting.value = true
      if (isEditing.value) {
        await authCenterClientService.updateAuthCenterClient(editingId.value, buildUpdatePayload())
        ElMessage.success(t('updateSuccess'))
      } else {
        const res = await authCenterClientService.createAuthCenterClient(buildCreatePayload())
        const secret = res?.data?.clientSecret
        if (secret) {
          createdSecret.value = secret
          showSecretDialog.value = true
        }
        ElMessage.success(t('createSuccess'))
      }
      showFormDialog.value = false
      resetForm()
      await loadClients()
    } catch (error: any) {
      if (error?.code === CustomCode.TWO_FACTOR_REQUIRED) return
      ElMessage.error(
        t(isEditing.value ? 'authCenterClient.updateFailed' : 'authCenterClient.createFailed'),
      )
      throw error
    } finally {
      submitting.value = false
    }
  }

  const handleRegenerateSecret = async (row: AuthCenterClientDto) => {
    try {
      await ElMessageBox.confirm(
        t('authCenterClient.regenerateSecretConfirm', { name: row.name }),
        t('authCenterClient.regenerateSecret'),
        { type: 'warning' },
      )
      const res = await authCenterClientService.regenerateSecret(row.id)
      createdSecret.value = res?.data?.clientSecret || ''
      showSecretDialog.value = true
      ElMessage.success(t('authCenterClient.regenerateSecretSuccess'))
      await loadClients()
    } catch (error: any) {
      if (error === 'cancel' || error?.code === CustomCode.TWO_FACTOR_REQUIRED) return
      ElMessage.error(t('authCenterClient.regenerateSecretFailed'))
    }
  }

  const handleDelete = async (row: AuthCenterClientDto) => {
    try {
      await ElMessageBox.confirm(
        t('authCenterClient.confirmDelete', { name: row.name }),
        t('confirmDialog.warning'),
        { type: 'warning' },
      )
      await authCenterClientService.deleteAuthCenterClient(row.id)
      ElMessage.success(t('deleteSuccess'))
      await loadClients()
    } catch (error) {
      if (error !== 'cancel') {
        ElMessage.error(t('authCenterClient.deleteFailed'))
      }
    }
  }

  const handleSubmitReview = async (row: AuthCenterClientDto) => {
    try {
      await ElMessageBox.confirm(
        t('authCenterClient.submitReviewConfirm', { name: row.name }),
        t('confirmDialog.warning'),
        { type: 'warning' },
      )
      await authCenterClientService.submitReview(row.id)
      ElMessage.success(t('authCenterClient.submitReviewSuccess'))
      await loadClients()
    } catch (error: any) {
      if (error === 'cancel' || error?.code === CustomCode.TWO_FACTOR_REQUIRED) return
      ElMessage.error(t('authCenterClient.submitReviewFailed'))
    }
  }

  const copyCreatedSecret = async () => {
    try {
      await navigator.clipboard.writeText(createdSecret.value)
      ElMessage.success(t('copySuccess'))
    } catch {
      ElMessage.error(t('copyFailed'))
    }
  }

  onMounted(() => {
    void loadClients()
  })

  return {
    isDesktop,
    clients,
    loading,
    submitting,
    showFormDialog,
    showSecretDialog,
    isEditing,
    editingId,
    createdSecret,
    form,
    isPkceLocked,
    grantTypeOptions,
    scopeOptions,
    grantTypeRows,
    getReviewStatusLabel,
    getReviewStatusTagType,
    canSubmitReview,
    getClientTypeLabel,
    getGrantTypeLabel,
    formatLifetime,
    loadClients,
    resetForm,
    openCreateDialog,
    openEditDialog,
    addRedirectUriRow,
    removeRedirectUriRow,
    handleSubmit,
    handleRegenerateSecret,
    handleDelete,
    handleSubmitReview,
    copyCreatedSecret,
  }
}

export type AuthCenterClientManagementState = ReturnType<typeof useAuthCenterClientManagement>
