import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import type {
  RelayChannelProbeLoginDto,
  SaveRelayChannelProbeAccountRequest,
  RelayProbeAccountSessionFieldDto,
  RelayProbeAccountExpiryMode,
} from '@/client/types.gen'
import { relayChannelProbeService } from '@/service/relayChannelProbeService'
import { i18ns } from '@/locales'
import { createUserFacingError } from '@/utils/error-utils'
import { showRequestErrorNotice } from '@/utils/requestErrorNotice'
import { ElMessage } from '@/utils/elementPlusRuntime'
import {
  bodyFields,
  makeKeyValueEntries,
  remainingRetainedFields,
  textFields,
} from './probe-form-fields'

const blank = () => ({
  name: '',
  method: 'POST' as 'GET' | 'POST',
  url: '',
  headers: makeKeyValueEntries({}),
  query: makeKeyValueEntries({}),
  body: makeKeyValueEntries({}),
  tokenPath: '',
  expiresPath: '',
  expiresMode: '' as '' | RelayProbeAccountExpiryMode,
  fallbackTtlSeconds: 1800,
  minLoginIntervalSeconds: 300,
  sessionFields: [] as RelayProbeAccountSessionFieldDto[],
  tokenField: '',
  refreshEnabled: false,
  refreshUrl: '',
  refreshMethod: 'POST' as 'GET' | 'POST',
  refreshHeaders: makeKeyValueEntries({}),
  refreshQuery: makeKeyValueEntries({}),
  refreshBody: makeKeyValueEntries({}),
  refreshTtlSeconds: 86400,
  allowedOrigins: [] as string[],
})

export function useProbeAccountEditor(onSaved: () => Promise<void>) {
  const newApiPreset = ref(false),
    panelOrigin = ref('')
  const form = reactive(blank())
  const open = ref(false),
    loading = ref(false),
    saving = ref(false)
  const editingId = ref<string>(),
    revision = ref<string>()
  const retainedFields = ref<string[][]>([]),
    retainedRefreshFields = ref<string[][]>([]),
    savedCredentialNames = ref<string[]>([]),
    savedRequiredNames = ref<string[]>([])
  const credentials = reactive<Record<string, string>>({})
  let requestId = 0

  const credentialNames = computed(() => {
    const names = new Set([...savedCredentialNames.value, ...savedRequiredNames.value])
    const text = JSON.stringify([
      form.url,
      form.headers.map((row) => row.value),
      form.query.map((row) => row.value),
      form.body.map((row) => row.value),
      ...(form.refreshEnabled
        ? [
            form.refreshUrl,
            form.refreshHeaders.map((row) => row.value),
            form.refreshQuery.map((row) => row.value),
            form.refreshBody.map((row) => row.value),
          ]
        : []),
    ])
    for (const match of text.matchAll(/\{\{([A-Za-z][A-Za-z0-9_.]*)\}\}/g)) names.add(match[1]!)
    return [...names]
      .filter((name) => name !== 'accountToken' && !name.startsWith('account.'))
      .sort()
  })
  const isSaved = (path: string[]) =>
    retainedFields.value.some((item) => JSON.stringify(path) === JSON.stringify(item))
  const savedKeys = (section: string) =>
    retainedFields.value
      .filter((path) => path[0] === section)
      .map((path) => path[1]!)
      .filter(Boolean)
  const savedRefreshKeys = (section: string) =>
    retainedRefreshFields.value
      .filter((path) => path[0] === section)
      .map((path) => path[1]!)
      .filter(Boolean)
  const refreshUrlSaved = computed(() =>
    retainedRefreshFields.value.some((path) => path.length === 1 && path[0] === 'url'),
  )
  function clearCredentials() {
    for (const key of Object.keys(credentials)) delete credentials[key]
  }
  function reset() {
    newApiPreset.value = false
    panelOrigin.value = ''
    Object.assign(form, blank())
    clearCredentials()
    revision.value = undefined
    retainedFields.value = []
    retainedRefreshFields.value = []
    savedCredentialNames.value = []
    savedRequiredNames.value = []
  }
  function create() {
    requestId++
    reset()
    loading.value = false
    editingId.value = undefined
    open.value = true
  }
  async function edit(id: string) {
    const current = ++requestId
    reset()
    editingId.value = id
    open.value = true
    loading.value = true
    try {
      const result = await relayChannelProbeService.getAccountEditor(id)
      if (current !== requestId || !open.value) return
      const account = result.account,
        workflow = result.loginWorkflow
      Object.assign(form, {
        name: account.name,
        method: workflow.method,
        url: workflow.url,
        headers: makeKeyValueEntries(workflow.headers),
        query: makeKeyValueEntries(workflow.query),
        body: makeKeyValueEntries(workflow.body, true),
        tokenPath: account.tokenPath,
        expiresPath: account.expiresPath ?? '',
        expiresMode: account.expiresMode ?? '',
        fallbackTtlSeconds: account.fallbackTtlSeconds,
        minLoginIntervalSeconds: account.minLoginIntervalSeconds,
        sessionFields: result.sessionFields ?? [],
        tokenField: result.tokenField ?? '',
        refreshEnabled: Boolean(result.refreshWorkflow),
        refreshUrl: result.refreshWorkflow?.url ?? '',
        refreshMethod: result.refreshWorkflow?.method ?? 'POST',
        refreshHeaders: makeKeyValueEntries(result.refreshWorkflow?.headers),
        refreshQuery: makeKeyValueEntries(result.refreshWorkflow?.query),
        refreshBody: makeKeyValueEntries(result.refreshWorkflow?.body, true),
        refreshTtlSeconds: result.refreshTtlSeconds ?? 86400,
        allowedOrigins: result.sessionAllowedOrigins ?? [],
      })
      revision.value = result.revision
      retainedFields.value = result.retainedFields
      retainedRefreshFields.value = result.retainedRefreshFields ?? []
      savedCredentialNames.value = result.credentialNames
      savedRequiredNames.value = result.requiredCredentialNames
    } catch (error) {
      if (current === requestId) {
        open.value = false
        showRequestErrorNotice(error, i18ns.t('operationFailed'))
      }
    } finally {
      if (current === requestId) loading.value = false
    }
  }
  function applyPasswordPreset() {
    newApiPreset.value = false
    form.method = 'POST'
    form.body = makeKeyValueEntries({ username: '{{username}}', password: '{{password}}' }, true)
    form.tokenPath = 'data.token'
  }
  function applyNewApiPreset() {
    applyPasswordPreset()
    newApiPreset.value = true
    form.tokenPath = 'data.access_token'
    form.expiresPath = 'data.access_expires_at'
    form.expiresMode = 'unixSeconds'
    form.sessionFields = [
      { name: 'userId', source: 'json', selector: 'data.user.id', required: false },
      { name: 'refreshCookie', source: 'cookie', selector: 'new_api_refresh', required: true },
    ]
    form.tokenField = ''
    form.refreshEnabled = true
    form.refreshMethod = 'POST'
    form.refreshHeaders = makeKeyValueEntries({ Cookie: '{{account.refreshCookie}}' })
    form.refreshBody = makeKeyValueEntries({})
    form.refreshQuery = makeKeyValueEntries({})
    try {
      form.refreshUrl = new URL('/api/user/auth/refresh', form.url).href
    } catch {
      form.refreshUrl = ''
    }
  }
  watch(panelOrigin, (value) => {
    if (!newApiPreset.value) return
    try {
      const base = new URL(value)
      if (
        !['https:', 'http:'].includes(base.protocol) ||
        base.username ||
        base.password ||
        base.search ||
        base.hash ||
        (base.pathname !== '/' && base.pathname !== '')
      )
        return
      form.url = new URL('/api/user/login', base.origin).href
      form.refreshUrl = new URL('/api/user/auth/refresh', base.origin).href
    } catch {
      /* Invalid input is handled by the save validation. */
    }
  })
  async function save() {
    if (saving.value || loading.value || (editingId.value && !revision.value)) return
    saving.value = true
    try {
      if (newApiPreset.value) {
        const base = new URL(panelOrigin.value)
        if (
          !['https:', 'http:'].includes(base.protocol) ||
          base.username ||
          base.password ||
          base.search ||
          base.hash ||
          base.pathname !== '/'
        )
          throw createUserFacingError(i18ns.t('relay.probePanelOriginInvalid'))
      }
      const loginWorkflow: RelayChannelProbeLoginDto = {
        method: form.method,
        url: form.url,
        headers: textFields(form.headers, i18ns.t('relay.probeAccountHeaders')),
        query: textFields(form.query, i18ns.t('relay.probeAccountQuery')),
        body: bodyFields(form.body),
      }
      const updates: Record<string, string> = {}
      const refreshWorkflow: RelayChannelProbeLoginDto | null = form.refreshEnabled
        ? {
            method: form.refreshMethod,
            url: form.refreshUrl,
            headers: textFields(form.refreshHeaders, i18ns.t('relay.probeAccountHeaders')),
            query: textFields(form.refreshQuery, i18ns.t('relay.probeAccountQuery')),
            body: bodyFields(form.refreshBody),
          }
        : null
      for (const name of credentialNames.value) {
        if (credentials[name]?.trim()) updates[name] = credentials[name]!
        else if (!savedCredentialNames.value.includes(name))
          throw createUserFacingError(i18ns.t('relay.channelProbeCredentialIncomplete'))
      }
      const body: SaveRelayChannelProbeAccountRequest = {
        name: form.name,
        loginWorkflow,
        tokenPath: form.tokenPath,
        expiresPath: form.expiresPath || undefined,
        expiresMode: form.expiresMode || undefined,
        fallbackTtlSeconds: form.fallbackTtlSeconds,
        minLoginIntervalSeconds: form.minLoginIntervalSeconds,
        sessionFields: form.sessionFields,
        tokenField: form.tokenField || null,
        refreshWorkflow,
        retainedRefreshFields: refreshWorkflow
          ? remainingRetainedFields(refreshWorkflow, retainedRefreshFields.value)
          : undefined,
        refreshTtlSeconds: form.refreshTtlSeconds,
        sessionAllowedOrigins: form.allowedOrigins,
        ...(editingId.value
          ? {
              expectedRevision: revision.value,
              retainedFields: remainingRetainedFields(loginWorkflow, retainedFields.value),
              credentialUpdates: updates,
            }
          : { credentials: updates }),
      }
      if (editingId.value) await relayChannelProbeService.updateAccount(editingId.value, body)
      else await relayChannelProbeService.createAccount(body)
      open.value = false
      clearCredentials()
      await onSaved()
      ElMessage.success(i18ns.t('success'))
    } catch (error) {
      showRequestErrorNotice(error, i18ns.t('operationFailed'))
    } finally {
      saving.value = false
    }
  }
  function close() {
    requestId++
    clearCredentials()
  }
  onBeforeUnmount(close)
  return {
    newApiPreset,
    panelOrigin,
    form,
    open,
    loading,
    saving,
    editingId,
    credentials,
    credentialNames,
    savedCredentialNames,
    isSaved,
    savedKeys,
    create,
    edit,
    save,
    close,
    applyPasswordPreset,
    applyNewApiPreset,
    savedRefreshKeys,
    refreshUrlSaved,
  }
}
