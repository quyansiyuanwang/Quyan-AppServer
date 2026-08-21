import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { RelayProbeFormat as SharedRelayChannelProbeFormat } from '@appserver/shared'
import { RELAY_PROBE_FORMATS } from '@appserver/shared'
import { ElMessage, ElMessageBox } from 'element-plus'
import { i18ns } from '@/locales'
import { Permission } from '@/constant/permission'
import { usePermissionStore } from '@/stores/permissionStore'
import { getErrorMessage } from '@/utils/error-utils'
import StorageKey from '@/constant/storagekey'
import { TypedLocalStorage } from '@/utils/typedLocalStorage'
import { relayChannelProbeService } from '@/service/relayChannelProbeService'
import { relayChannelService } from '@/service/relayChannelService'
import { type ProbeKeyValueEntry } from '../components/ProbeKeyValueEditor.vue'
import type { TableInstance } from 'element-plus'
import type {
  RelayChannelProbeEndpoint,
  RelayChannelProbeCacheMode,
  RelayChannelProbeCustomerFacingTargetDto,
  RelayChannelProbeOverviewItemDto,
  RelayChannelProbeRunDto,
  RelayChannelProbeRunStatus,
  RelayChannelProbeWorkflowStepDto,
  RelayChannelDto,
} from '@/client/types.gen'
type RelayChannelProbeFormat = SharedRelayChannelProbeFormat

interface WorkflowFormStep {
  id: string
  name: string
  method: 'GET' | 'POST'
  openSections: string[]
  url: string
  headers: ProbeKeyValueEntry[]
  query: ProbeKeyValueEntry[]
  body: ProbeKeyValueEntry[]
  extract: ProbeKeyValueEntry[]
  balancePath: string
}
interface CredentialFormRow {
  id: string
  name: string
  value: string
}
interface ProbeForm {
  enabled: boolean
  probeFormat: RelayChannelProbeFormat
  probeEndpoint: RelayChannelProbeEndpoint
  cacheMode: RelayChannelProbeCacheMode
  sampleCount: number
  strictCalibrationValidation: boolean
  measurementInputTokens: number
  balanceSettlementTolerance: number
  balanceSettlementReads: number
  probeModel: string
  distributionMultiplier: number
  upstreamCurrency: string
  localCurrency: string
  upstreamBalanceDivisor: number
  upstreamRateMultiplier: number
  probeGroup: string
}
interface ApplyMultiplierDraft {
  run: RelayChannelProbeRunDto
  channelName: string
  currentMultiplier: number
  suggestedMultiplier: number
  targetMultiplier: number
}
interface MultiplierChangeRow {
  channelId: string
  channelName: string
  customerFacingTargets: RelayChannelProbeCustomerFacingTargetDto[]
  sourceMultiplier: number
  targetMultiplier: number
  change: number
  changePercent: number
  applied: boolean
  costFactors: string
  targetCost?: number
  time: string | Date
}
interface ProbeProfileExport {
  version: 2
  type: 'relay-channel-probe-profile'
  profile: ProbeForm & {
    probePayload: Record<string, unknown>
    workflow: RelayChannelProbeWorkflowStepDto[]
  }
}
type CredentialRequirement = {
  name: string
  missing: boolean
  label: string
  type: 'success' | 'info' | 'warning'
}

export const useRelayChannelProbeManagement = () => {
  // Keep this aligned with the backend's large-change guard. The value only
  // controls whether the explicit override control is relevant to the user.
  const LARGE_MULTIPLIER_CHANGE_RATIO = 0.2
  const permissionStore = usePermissionStore()
  const canExecute = computed(() =>
    permissionStore.hasPermission(Permission.RELAY_CHANNEL_PROBE_EXECUTE),
  )
  const canAdjust = computed(() =>
    permissionStore.hasPermission(Permission.RELAY_CHANNEL_MULTIPLIER_ADJUST),
  )
  const loading = ref(false)
  const saving = ref(false)
  const clearingProfile = ref(false)
  const applying = ref(false)
  const applyDialogOpen = ref(false)
  const exportAppliedChangeChart = ref(false)
  const forceLargeMultiplierChange = ref(false)
  const roundingDigits = ref(4)
  const roundingMode = ref<'ceil' | 'nearest'>('ceil')
  const applyDrafts = ref<ApplyMultiplierDraft[]>([])
  const applyTableRef = ref<TableInstance>()
  const selectedApplyRunIds = ref<string[]>([])
  const hasLargeMultiplierChange = computed(() =>
    applyDrafts.value
      .filter((draft) => selectedApplyRunIds.value.includes(draft.run.id))
      .some(
        (draft) =>
          Math.abs(draft.targetMultiplier - draft.currentMultiplier) /
            Math.max(draft.currentMultiplier, Number.EPSILON) >
          LARGE_MULTIPLIER_CHANGE_RATIO,
      ),
  )
  const selectionTolerancePercent = ref(1)
  const selectionDirection = ref<'all' | 'increase' | 'decrease'>('all')
  const rememberApplySettings = ref(false)
  const APPLY_SETTINGS_STORAGE_KEY = StorageKey.Relay.CHANNEL_PROBE_APPLY_SETTINGS
  type RememberedApplySettings = {
    roundingDigits: number
    roundingMode: 'ceil' | 'nearest'
    selectionTolerancePercent: number
    selectionDirection: 'all' | 'increase' | 'decrease'
  }
  const changeDialogOpen = ref(false)
  const changeSort = ref<'largest' | 'smallest' | 'recent'>('largest')
  const changeDirection = ref<'all' | 'increase' | 'decrease'>('all')
  const changeTypeFilter = ref<'all' | 'suggested' | 'applied'>('all')
  const changeMinimumPercent = ref(0)
  const changeDisplayDigits = ref(4)
  const changeDisplayRoundingMode = ref<'ceil' | 'nearest'>('nearest')
  const changePage = ref(1)
  const changePageSize = ref(50)
  const batchRunning = ref(false)
  const batchProfileDialogOpen = ref(false)
  const batchProfileSaving = ref(false)
  const batchProfileSourceChannelId = ref('')
  const batchProfileOverwriteExisting = ref(false)
  const runsLoading = ref(false)
  const runningId = ref('')
  const resettingChannelId = ref('')
  const clearingHistoryScope = ref<'' | 'all' | 'failed'>('')
  const forceWithoutCacheBuster = ref(false)
  const pageError = ref('')
  const items = ref<RelayChannelProbeOverviewItemDto[]>([])
  const legacyChannelTopology = ref<RelayChannelDto[] | null>(null)
  const selected = ref<RelayChannelProbeOverviewItemDto | null>(null)
  const drawerOpen = ref(false)
  const tab = ref('profile')
  const runs = ref<RelayChannelProbeRunDto[]>([])
  const selectedRows = ref<RelayChannelProbeOverviewItemDto[]>([])
  const tableRef = ref<TableInstance>()
  const keyword = ref('')
  const profileFilter = ref<'all' | 'configured' | 'unconfigured'>('all')
  const enabledFilter = ref<'all' | 'enabled' | 'disabled'>('enabled')
  const runStatusFilter = ref<'all' | 'none' | RelayChannelProbeRunStatus>('all')
  const suggestionFilter = ref<'all' | 'applicable' | 'not_applicable'>('all')
  const runStatuses: RelayChannelProbeRunStatus[] = [
    'queued',
    'running',
    'succeeded',
    'failed',
    'timed_out',
    'cancelled',
  ]
  const filteredItems = computed(() =>
    items.value.filter((item) => {
      const matchKeyword =
        !keyword.value ||
        [item.channelName, item.channelId].some((value) =>
          value.toLowerCase().includes(keyword.value.toLowerCase()),
        )
      const matchProfile =
        profileFilter.value === 'all' ||
        (profileFilter.value === 'configured' ? Boolean(item.profile) : !item.profile)
      const matchEnabled =
        enabledFilter.value === 'all' ||
        (enabledFilter.value === 'enabled' ? item.enabled : !item.enabled)
      const matchRun =
        runStatusFilter.value === 'all' ||
        (runStatusFilter.value === 'none'
          ? !item.latestRun
          : item.latestRun?.status === runStatusFilter.value)
      const matchSuggestion =
        suggestionFilter.value === 'all' ||
        (suggestionFilter.value === 'applicable'
          ? isApplicable(item.latestRun)
          : !isApplicable(item.latestRun))
      return matchKeyword && matchProfile && matchEnabled && matchRun && matchSuggestion
    }),
  )
  const multiplierChangeRows = computed<MultiplierChangeRow[]>(() => {
    const rows = items.value.flatMap((item) => {
      const run = item.latestRun
      const sourceMultiplier = Number(run?.sourceChannelMultiplier)
      const targetMultiplier = Number(run?.appliedMultiplier ?? run?.suggestedMultiplier)
      if (!run || !Number.isFinite(sourceMultiplier) || !Number.isFinite(targetMultiplier))
        return []
      const change = targetMultiplier - sourceMultiplier
      const changePercent = sourceMultiplier
        ? (Math.abs(change) / Math.abs(sourceMultiplier)) * 100
        : change === 0
          ? 0
          : Number.POSITIVE_INFINITY
      const matchesDirection =
        changeDirection.value === 'all' ||
        (changeDirection.value === 'increase' && change > 0) ||
        (changeDirection.value === 'decrease' && change < 0)
      const applied = Boolean(run.appliedAt)
      const matchesType =
        changeTypeFilter.value === 'all' ||
        (changeTypeFilter.value === 'applied' && applied) ||
        (changeTypeFilter.value === 'suggested' && !applied)
      if (!matchesDirection || !matchesType || changePercent <= changeMinimumPercent.value)
        return []
      return [
        {
          channelId: item.channelId,
          channelName: item.channelName,
          customerFacingTargets: item.customerFacingTargets,
          sourceMultiplier,
          targetMultiplier,
          change,
          changePercent,
          applied,
          costFactors:
            formatNumber(run.upstreamRateMultiplier) +
            ' × ' +
            formatNumber(run.distributionMultiplier),
          targetCost: targetLocalCost(run),
          time: run.appliedAt ?? run.finishedAt ?? run.createTime,
        },
      ]
    })
    return rows.sort((left, right) => {
      if (changeSort.value === 'largest') return right.changePercent - left.changePercent
      if (changeSort.value === 'smallest') return left.changePercent - right.changePercent
      return new Date(right.time).getTime() - new Date(left.time).getTime()
    })
  })
  const publicMultiplierChangeRows = computed<MultiplierChangeRow[]>(() =>
    toCustomerFacingMultiplierChangeRows(multiplierChangeRows.value),
  )
  function toCustomerFacingMultiplierChangeRows(
    rows: MultiplierChangeRow[],
  ): MultiplierChangeRow[] {
    const rowsByCustomerEntry = new Map<string, MultiplierChangeRow>()
    for (const row of rows) {
      for (const target of Array.isArray(row.customerFacingTargets)
        ? row.customerFacingTargets
        : []) {
        const sourceMultiplier = roundMultiplierForPrecision(
          row.sourceMultiplier,
          changeDisplayDigits.value,
          changeDisplayRoundingMode.value,
        )
        const targetMultiplier = roundMultiplierForPrecision(
          row.targetMultiplier,
          changeDisplayDigits.value,
          changeDisplayRoundingMode.value,
        )
        const key = [target.channelId, sourceMultiplier, targetMultiplier].join(':')
        if (rowsByCustomerEntry.has(key)) continue
        rowsByCustomerEntry.set(key, {
          ...row,
          channelId: target.channelId,
          channelName: target.channelName,
          customerFacingTargets: [target],
          sourceMultiplier,
          targetMultiplier,
          change: targetMultiplier - sourceMultiplier,
          changePercent: multiplierRelativeChangePercent(sourceMultiplier, targetMultiplier),
        })
      }
    }
    return [...rowsByCustomerEntry.values()]
  }
  const applyDirectionMaximumPercent = computed(() =>
    maximumMultiplierRelativeChange(
      applyDrafts.value.map((draft) => [draft.currentMultiplier, draft.targetMultiplier] as const),
    ),
  )
  const customerFacingDirectionMaximumPercent = computed(() =>
    maximumMultiplierRelativeChange(
      publicMultiplierChangeRows.value.map(
        (row) => [row.sourceMultiplier, row.targetMultiplier] as const,
      ),
    ),
  )
  const pagedCustomerFacingMultiplierChangeRows = computed(() => {
    const start = (changePage.value - 1) * changePageSize.value
    return publicMultiplierChangeRows.value.slice(start, start + changePageSize.value)
  })
  const selectedRuns = computed(() =>
    selectedRows.value.flatMap((row) => (isApplicable(row.latestRun) ? [row.latestRun!.id] : [])),
  )
  const selectedProbeFormats = computed(() => selected.value?.allowedProbeFormats ?? [])
  const selectedProbeModels = computed(() => selected.value?.allowedProbeModels ?? [])
  const hasActiveProbeRuns = computed(() =>
    items.value.some(
      (item) => item.latestRun?.status === 'queued' || item.latestRun?.status === 'running',
    ),
  )
  const runnableChannelIds = computed(() =>
    selectedRows.value.flatMap((row) => (isRunnable(row) ? [row.channelId] : [])),
  )
  const batchProfileSources = computed(() =>
    selectedRows.value.filter((row) => Boolean(row.profile)),
  )
  const batchProfileTargets = computed(() =>
    selectedRows.value.filter((row) => row.channelId !== batchProfileSourceChannelId.value),
  )
  const canBatchCopyProfile = computed(
    () => selectedRows.value.length >= 2 && batchProfileSources.value.length > 0,
  )
  const form = ref<ProbeForm>(emptyForm())
  const payloadText = ref('')
  const workflowSteps = ref<WorkflowFormStep[]>([])
  const credentials = ref<CredentialFormRow[]>([])
  const credentialNames = ref<string[]>([])
  const importDialogOpen = ref(false)
  const importText = ref('')
  const importFileInput = ref<HTMLInputElement>()
  const balancePathCount = computed(
    () => workflowSteps.value.filter((step) => Boolean(step.balancePath.trim())).length,
  )
  const currenciesMatch = computed(() =>
    Boolean(
      form.value.upstreamCurrency.trim() &&
        form.value.localCurrency.trim() &&
        form.value.upstreamCurrency.trim().toUpperCase() ===
          form.value.localCurrency.trim().toUpperCase(),
    ),
  )
  const extractedVariableNames = computed(
    () =>
      new Set(
        workflowSteps.value.flatMap((step) =>
          step.extract.map((entry) => entry.key.trim()).filter(Boolean),
        ),
      ),
  )
  const requiredCredentialStates = computed<CredentialRequirement[]>(() => {
    const referenced = new Set<string>()
    collectVariableReferences(payloadText.value, referenced)
    for (const step of workflowSteps.value) {
      collectVariableReferences(step.url, referenced)
      for (const field of [...step.headers, ...step.query, ...step.body])
        collectVariableReferences(field.value, referenced)
    }
    const saved = new Set(credentialNames.value)
    const draft = new Set(
      credentials.value
        .filter((credential) => Boolean(credential.value))
        .map((credential) => credential.name.trim()),
    )
    return Array.from(referenced)
      .filter((name) => !extractedVariableNames.value.has(name))
      .sort((left, right) => left.localeCompare(right))
      .map((name) => {
        if (saved.has(name))
          return {
            name,
            missing: false,
            label: i18ns.t('relay.channelProbeCredentialSavedStatus'),
            type: 'success' as const,
          }
        if (draft.has(name))
          return {
            name,
            missing: false,
            label: i18ns.t('relay.channelProbeCredentialDraftStatus'),
            type: 'info' as const,
          }
        return {
          name,
          missing: true,
          label: i18ns.t('relay.channelProbeCredentialMissingStatus'),
          type: 'warning' as const,
        }
      })
  })
  const availableVariables = computed(() =>
    Array.from(
      new Set([
        ...credentialNames.value,
        ...credentials.value.map((credential) => credential.name.trim()).filter(Boolean),
        ...workflowSteps.value.flatMap((step) =>
          step.extract.map((entry) => entry.key.trim()).filter(Boolean),
        ),
      ]),
    ),
  )
  let overviewRequest = 0
  let runsRequest = 0
  let pollTimer: ReturnType<typeof setTimeout> | undefined
  let polling = false
  let pollingEnabled = false

  function emptyForm(): ProbeForm {
    return {
      enabled: true,
      probeFormat: 'openai-chat-completions',
      probeEndpoint: 'openai-chat-completions',
      cacheMode: 'cache-bust',
      sampleCount: 3,
      strictCalibrationValidation: false,
      measurementInputTokens: 1024,
      balanceSettlementTolerance: 0.000001,
      balanceSettlementReads: 2,
      probeModel: '',
      distributionMultiplier: 1,
      upstreamCurrency: 'CNY',
      localCurrency: 'CNY',
      upstreamBalanceDivisor: 1,
      upstreamRateMultiplier: 1,
      probeGroup: '',
    }
  }
  function isProbeFormatAvailable(format: RelayChannelProbeFormat) {
    const normalizedFormat = format === 'openai' ? 'openai-chat-completions' : format
    return (
      selectedProbeFormats.value.length === 0 ||
      selectedProbeFormats.value.includes(normalizedFormat)
    )
  }
  const probeEndpointOptions = computed<RelayChannelProbeEndpoint[]>(() => {
    if (form.value.probeFormat === 'openai-chat-completions') return ['openai-chat-completions']
    if (form.value.probeFormat === 'openai-responses') return ['openai-responses']
    if (form.value.probeFormat === 'anthropic') return ['anthropic-messages']
    if (form.value.probeFormat === 'gemini') return ['gemini-generate-content']
    return ['openai-chat-completions', 'openai-responses']
  })
  function probeEndpointLabel(endpoint: RelayChannelProbeEndpoint) {
    return i18ns.t(`relay.channelProbeEndpoint${endpoint}` as any)
  }
  const probeEndpointHelp = computed(() =>
    i18ns.t(`relay.channelProbeEndpointHelp${form.value.probeEndpoint}` as any),
  )
  const cacheModeHelp = computed(() =>
    i18ns.t(`relay.channelProbeCacheModeHelp${form.value.cacheMode}` as any),
  )
  function sampleStatusLabel(status: string) {
    return i18ns.t(`relay.channelProbeSampleStatus${status}` as any)
  }
  function calibrationStatusLabel(status: string) {
    const key =
      status === 'verified'
        ? 'relay.channelProbeCalibrationVerified'
        : status === 'low-signal'
          ? 'relay.channelProbeCalibrationLowSignal'
          : status === 'insufficient-samples'
            ? 'relay.channelProbeCalibrationInsufficientSamples'
            : status === 'unstable'
              ? 'relay.channelProbeCalibrationUnstable'
              : 'relay.channelProbeCalibrationPending'
    return i18ns.t(key)
  }
  function defaultEndpointForFormat(format: RelayChannelProbeFormat): RelayChannelProbeEndpoint {
    return format === 'openai-responses'
      ? 'openai-responses'
      : format === 'openai-chat-completions'
        ? 'openai-chat-completions'
        : format === 'anthropic'
          ? 'anthropic-messages'
          : format === 'gemini'
            ? 'gemini-generate-content'
            : 'openai-chat-completions'
  }
  function makeStep(): WorkflowFormStep {
    return {
      id: crypto.randomUUID(),
      name: 'balance',
      method: 'GET',
      openSections: [],
      url: '',
      headers: [],
      query: [],
      body: [],
      extract: [],
      balancePath: 'balance',
    }
  }
  function addWorkflowStep() {
    if (workflowSteps.value.length < 3) workflowSteps.value.push(makeStep())
  }
  function removeWorkflowStep(index: number) {
    workflowSteps.value.splice(index, 1)
  }
  function addCredential(name = '') {
    const normalizedName = name.trim()
    if (
      normalizedName &&
      credentials.value.some((credential) => credential.name.trim() === normalizedName)
    )
      return
    credentials.value.push({ id: crypto.randomUUID(), name: normalizedName, value: '' })
  }
  function variableTemplate(name: string) {
    return `{{${name}}}`
  }
  function collectVariableReferences(value: string, output: Set<string>) {
    const expression = /\{\{\s*([A-Za-z][A-Za-z0-9_]{0,49})\s*\}\}/g
    for (const match of value.matchAll(expression)) output.add(match[1]!)
  }
  async function copyVariable(name: string) {
    try {
      await navigator.clipboard.writeText(variableTemplate(name))
      ElMessage.success(i18ns.t('relay.channelProbeVariableCopied'))
    } catch {
      ElMessage.warning(i18ns.t('relay.channelProbeVariableCopyFailed'))
    }
  }
  function applyPayloadPreset() {
    payloadText.value = JSON.stringify(
      createDefaultProbePayload(form.value.probeFormat, form.value.probeEndpoint),
      null,
      2,
    )
    ElMessage.success(i18ns.t('relay.channelProbePresetApplied'))
  }
  function isPayloadPreset(format: RelayChannelProbeFormat, endpoint: RelayChannelProbeEndpoint) {
    try {
      return (
        JSON.stringify(JSON.parse(payloadText.value)) ===
        JSON.stringify(createDefaultProbePayload(format, endpoint))
      )
    } catch {
      return false
    }
  }
  function createDefaultProbePayload(
    format: RelayChannelProbeFormat,
    endpoint: RelayChannelProbeEndpoint,
  ): Record<string, unknown> {
    const prompt = 'Reply with OK.'
    return endpoint === 'openai-responses'
      ? {
          input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }],
          max_output_tokens: 1,
        }
      : format === 'anthropic'
        ? { max_tokens: 1, messages: [{ role: 'user', content: prompt }] }
        : format === 'gemini'
          ? { contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 1 } }
          : { messages: [{ role: 'user', content: prompt }], max_tokens: 1 }
  }
  function createProfileExport(): ProbeProfileExport {
    return {
      version: 2,
      type: 'relay-channel-probe-profile',
      profile: {
        ...form.value,
        probePayload: parseObject(payloadText.value, i18ns.t('relay.channelProbePayload')),
        workflow: formWorkflow(),
      },
    }
  }
  function serializeProfileExport(): string | undefined {
    try {
      return JSON.stringify(createProfileExport(), null, 2)
    } catch (error) {
      ElMessage.warning(getErrorMessage(error, i18ns.t('operationFailed')))
      return undefined
    }
  }
  function downloadConfiguration() {
    const content = serializeProfileExport()
    if (!content) return
    const blob = new Blob([content], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const channelName = (selected.value?.channelName || 'channel').replace(/[^A-Za-z0-9_-]+/g, '-')
    link.href = url
    link.download = `relay-probe-${channelName}.json`
    link.click()
    URL.revokeObjectURL(url)
    ElMessage.success(i18ns.t('relay.channelProbeExported'))
  }
  async function copyConfiguration() {
    const content = serializeProfileExport()
    if (!content) return
    try {
      await navigator.clipboard.writeText(content)
      ElMessage.success(i18ns.t('relay.channelProbeCopied'))
    } catch {
      ElMessage.warning(i18ns.t('relay.channelProbeCopyFailed'))
    }
  }
  function openImportDialog() {
    importText.value = ''
    importDialogOpen.value = true
  }
  function triggerImportFile() {
    importFileInput.value?.click()
  }
  async function readImportFile(event: Event) {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    try {
      importText.value = await file.text()
    } catch {
      ElMessage.error(i18ns.t('relay.channelProbeImportInvalid'))
    }
  }
  function parseImportedProfile(): ProbeProfileExport['profile'] {
    try {
      const parsed: unknown = JSON.parse(importText.value)
      if (!parsed || typeof parsed !== 'object') throw new Error()
      const source = ('profile' in parsed ? parsed.profile : parsed) as Partial<
        ProbeProfileExport['profile']
      > & { preventCache?: boolean }
      if (
        !source ||
        !RELAY_PROBE_FORMATS.includes(
          String(source.probeFormat) as SharedRelayChannelProbeFormat,
        ) ||
        typeof source.probeModel !== 'string' ||
        !source.probePayload ||
        typeof source.probePayload !== 'object' ||
        Array.isArray(source.probePayload) ||
        !Array.isArray(source.workflow)
      )
        throw new Error()
      return {
        enabled: source.enabled !== false,
        probeFormat: source.probeFormat as RelayChannelProbeFormat,
        probeEndpoint:
          source.probeEndpoint &&
          [
            'openai-chat-completions',
            'openai-responses',
            'anthropic-messages',
            'gemini-generate-content',
          ].includes(source.probeEndpoint)
            ? source.probeEndpoint
            : defaultEndpointForFormat(source.probeFormat as RelayChannelProbeFormat),
        cacheMode:
          source.cacheMode &&
          ['cache-bust', 'allow-cache', 'warm-and-read'].includes(source.cacheMode)
            ? source.cacheMode
            : source.preventCache === false
              ? 'allow-cache'
              : 'cache-bust',
        sampleCount: validSampleCount(source.sampleCount),
        strictCalibrationValidation: source.strictCalibrationValidation === true,
        measurementInputTokens: validMeasurementInputTokens(source.measurementInputTokens),
        balanceSettlementTolerance: validBalanceSettlementTolerance(
          source.balanceSettlementTolerance,
        ),
        balanceSettlementReads: validBalanceSettlementReads(source.balanceSettlementReads),
        probeModel: source.probeModel,
        distributionMultiplier: Number(source.distributionMultiplier) || 1,
        upstreamCurrency:
          typeof source.upstreamCurrency === 'string' ? source.upstreamCurrency : 'CNY',
        localCurrency: typeof source.localCurrency === 'string' ? source.localCurrency : 'CNY',
        upstreamBalanceDivisor: validBalanceDivisor(source.upstreamBalanceDivisor),
        upstreamRateMultiplier: validUpstreamRateMultiplier(source.upstreamRateMultiplier),
        probeGroup: typeof source.probeGroup === 'string' ? source.probeGroup.trim() : '',
        probePayload: source.probePayload as Record<string, unknown>,
        workflow: source.workflow as RelayChannelProbeWorkflowStepDto[],
      }
    } catch {
      throw new Error(i18ns.t('relay.channelProbeImportInvalid'))
    }
  }
  function validBalanceDivisor(value: unknown): number {
    if (value == null) return 1
    const divisor = Number(value)
    if (!Number.isFinite(divisor) || divisor < 0.000001 || divisor > 1_000_000_000)
      throw new Error(i18ns.t('relay.channelProbeInvalidBalanceDivisor'))
    return divisor
  }
  function validUpstreamRateMultiplier(value: unknown): number {
    if (value == null) return 1
    const multiplier = Number(value)
    if (!Number.isFinite(multiplier) || multiplier < 0.000001 || multiplier > 1000)
      throw new Error(i18ns.t('relay.channelProbeInvalidUpstreamRate'))
    return multiplier
  }
  function validSampleCount(value: unknown): number {
    if (value == null) return 3
    const count = Number(value)
    if (!Number.isInteger(count) || count < 1 || count > 10)
      throw new Error(i18ns.t('relay.channelProbeInvalidSampleCount'))
    return count
  }
  function validMeasurementInputTokens(value: unknown): number {
    if (value == null) return 1024
    const count = Number(value)
    if (!Number.isInteger(count) || count < 0 || count > 32768)
      throw new Error(i18ns.t('relay.channelProbeInvalidSampleCount'))
    return count
  }
  function validBalanceSettlementTolerance(value: unknown): number {
    if (value == null) return 0.000001
    const tolerance = Number(value)
    const scaledTolerance = tolerance * 1_000_000
    if (
      !Number.isFinite(tolerance) ||
      tolerance < 0.000001 ||
      tolerance > 1000000 ||
      Math.abs(Math.round(scaledTolerance) - scaledTolerance) >= 1e-8
    )
      throw new Error(i18ns.t('relay.channelProbeInvalidBalanceSettlementTolerance'))
    return tolerance
  }
  function validBalanceSettlementReads(value: unknown): number {
    if (value == null) return 2
    const reads = Number(value)
    if (!Number.isInteger(reads) || reads < 2 || reads > 5)
      throw new Error(i18ns.t('relay.channelProbeInvalidSampleCount'))
    return reads
  }
  function applyImportedConfiguration() {
    try {
      const imported = parseImportedProfile()
      form.value = {
        enabled: imported.enabled,
        probeFormat: imported.probeFormat,
        probeEndpoint: imported.probeEndpoint,
        cacheMode: imported.cacheMode,
        sampleCount: imported.sampleCount,
        strictCalibrationValidation: imported.strictCalibrationValidation,
        measurementInputTokens: imported.measurementInputTokens,
        balanceSettlementTolerance: imported.balanceSettlementTolerance,
        balanceSettlementReads: imported.balanceSettlementReads,
        probeModel: imported.probeModel,
        distributionMultiplier: imported.distributionMultiplier,
        upstreamCurrency: imported.upstreamCurrency,
        localCurrency: imported.localCurrency,
        upstreamBalanceDivisor: imported.upstreamBalanceDivisor,
        upstreamRateMultiplier: imported.upstreamRateMultiplier,
        probeGroup: imported.probeGroup,
      }
      payloadText.value = JSON.stringify(imported.probePayload, null, 2)
      workflowSteps.value = imported.workflow.map(toWorkflowForm)
      importDialogOpen.value = false
      ElMessage.success(i18ns.t('relay.channelProbeImported'))
    } catch (error) {
      ElMessage.error(getErrorMessage(error, i18ns.t('relay.channelProbeImportInvalid')))
    }
  }
  function statusLabel(status: string) {
    return (
      (
        {
          queued: i18ns.t('relay.channelProbeStatusQueued'),
          running: i18ns.t('relay.channelProbeStatusRunning'),
          succeeded: i18ns.t('relay.channelProbeStatusSucceeded'),
          failed: i18ns.t('relay.channelProbeStatusFailed'),
          timed_out: i18ns.t('relay.channelProbeStatusTimedOut'),
          cancelled: i18ns.t('relay.channelProbeStatusCancelled'),
        } as Record<string, string>
      )[status] || status
    )
  }
  function formatProbeError(message: string) {
    const phases = [
      ['读取请求前余额失败：', 'relay.channelProbePhaseBeforeBalanceFailed'],
      ['最小模型请求失败：', 'relay.channelProbePhaseModelRequestFailed'],
      ['读取请求后余额失败：', 'relay.channelProbePhaseAfterBalanceFailed'],
    ] as const
    const phase = phases.find(([prefix]) => message.startsWith(prefix))
    const phaseReason = phase ? message.slice(phase[0].length).trimStart() : message
    const missingVariable = phaseReason.match(/PROBE_VARIABLE_MISSING:([A-Za-z][A-Za-z0-9_.]*)/)
    const reason = missingVariable
      ? i18ns.t('relay.channelProbeErrorVariableMissing', { variable: missingVariable[1] })
      : phaseReason.includes('PROBE_NETWORK_CONFIGURATION_INVALID') ||
          /invalid ip address:\s*undefined/i.test(phaseReason)
        ? i18ns.t('relay.channelProbeErrorNetworkConfiguration')
        : phaseReason
    if (phase) return i18ns.t(phase[1], { reason })
    return reason
  }
  function statusType(status: string): 'info' | 'warning' | 'success' | 'danger' {
    return status === 'succeeded'
      ? 'success'
      : status === 'failed' || status === 'timed_out'
        ? 'danger'
        : status === 'running'
          ? 'warning'
          : 'info'
  }
  function formatDate(value?: string | Date) {
    return value ? new Date(value).toLocaleString() : '-'
  }
  function formatNumber(value?: number) {
    return value == null
      ? '-'
      : Number(value)
          .toFixed(6)
          .replace(/\.?0+$/, '')
  }
  function isApplicable(run?: RelayChannelProbeRunDto) {
    return Boolean(
      run &&
        run.status === 'succeeded' &&
        run.calibrationStatus === 'verified' &&
        run.suggestedMultiplier != null &&
        !run.appliedAt,
    )
  }
  function suggestionUnavailableReason(run: RelayChannelProbeRunDto) {
    if (run.suggestedMultiplier != null) return ''
    const profile = selected.value?.profile
    if (profile && profile.upstreamCurrency !== profile.localCurrency)
      return i18ns.t('relay.channelProbeSuggestionCurrencyMismatch', {
        upstream: profile.upstreamCurrency,
        local: profile.localCurrency,
      })
    if (!run.totalTokens) return i18ns.t('relay.channelProbeSuggestionMissingUsage')
    if (run.upstreamBalanceDelta == null || run.upstreamBalanceDelta === 0)
      return i18ns.t('relay.channelProbeSuggestionNoDelta')
    if (run.upstreamBalanceDelta < 0) return i18ns.t('relay.channelProbeSuggestionBalanceIncreased')
    if (!run.baseLocalCost || run.baseLocalCost <= 0)
      return i18ns.t('relay.channelProbeSuggestionNoBaseCost')
    return i18ns.t('relay.channelProbeSuggestionUnavailable')
  }
  function isRunnable(row: RelayChannelProbeOverviewItemDto) {
    return Boolean(row.enabled && row.profile?.enabled)
  }
  function canSelectRow(row: RelayChannelProbeOverviewItemDto) {
    return Boolean(
      (canExecute.value && row.enabled) || (canAdjust.value && isApplicable(row.latestRun)),
    )
  }
  function onSelectionChange(rows: RelayChannelProbeOverviewItemDto[]) {
    selectedRows.value = rows
  }
  function clearSelection() {
    selectedRows.value = []
    tableRef.value?.clearSelection()
  }
  function getApplicableRuns(runIds: string[]) {
    const channelById = new Map(items.value.map((item) => [item.channelId, item]))
    const runsById = new Map(
      [...items.value.map((item) => item.latestRun), ...runs.value]
        .filter((run): run is RelayChannelProbeRunDto => isApplicable(run))
        .map((run) => [run.id, run]),
    )
    return runIds.flatMap((runId) => {
      const run = runsById.get(runId)
      const channel = run ? channelById.get(run.relayChannelId) : undefined
      return run && channel && isApplicable(run) && run.suggestedMultiplier != null
        ? [
            {
              run,
              channelName: channel.channelName,
              currentMultiplier: channel.multiplier,
              suggestedMultiplier: run.suggestedMultiplier,
              targetMultiplier: run.suggestedMultiplier,
            },
          ]
        : []
    })
  }
  function roundDraftMultipliers() {
    for (const draft of applyDrafts.value)
      draft.targetMultiplier = Math.max(
        0.000001,
        roundMultiplierForPrecision(
          draft.suggestedMultiplier,
          roundingDigits.value,
          roundingMode.value,
        ),
      )
  }
  watch([roundingDigits, roundingMode], () => {
    if (applyDialogOpen.value && applyDrafts.value.length > 0 && !applying.value)
      roundDraftMultipliers()
  })
  watch(hasLargeMultiplierChange, (hasLargeChange) => {
    if (!hasLargeChange) forceLargeMultiplierChange.value = false
  })
  watch(
    [
      rememberApplySettings,
      roundingDigits,
      roundingMode,
      selectionTolerancePercent,
      selectionDirection,
    ],
    () => {
      if (!rememberApplySettings.value) {
        TypedLocalStorage.removeItem(APPLY_SETTINGS_STORAGE_KEY)
        return
      }
      const settings: RememberedApplySettings = {
        roundingDigits: roundingDigits.value,
        roundingMode: roundingMode.value,
        selectionTolerancePercent: selectionTolerancePercent.value,
        selectionDirection: selectionDirection.value,
      }
      TypedLocalStorage.set(APPLY_SETTINGS_STORAGE_KEY, settings)
    },
  )
  function roundMultiplierForPrecision(value: number, digits: number, mode: 'ceil' | 'nearest') {
    const factor = 10 ** digits
    return (
      (mode === 'ceil'
        ? Math.ceil((value - Number.EPSILON) * factor)
        : Math.round((value + Number.EPSILON) * factor)) / factor
    )
  }
  function targetLocalCost(run: RelayChannelProbeRunDto) {
    const delta = Number(run.upstreamBalanceDelta ?? 0)
    const upstreamRate = Number(run.upstreamRateMultiplier ?? 1)
    const distribution = Number(run.distributionMultiplier ?? 1)
    const result = delta * upstreamRate * distribution
    return Number.isFinite(result) ? result : undefined
  }
  function currentChannelMultiplier(run: RelayChannelProbeRunDto) {
    const current = Number(selected.value?.multiplier)
    if (Number.isFinite(current) && current >= 0) return current
    const recorded = Number(run.sourceChannelMultiplier)
    return Number.isFinite(recorded) && recorded >= 0 ? recorded : undefined
  }
  function estimatedCurrentCharge(run: RelayChannelProbeRunDto) {
    const base = Number(run.baseLocalCost)
    const multiplier = currentChannelMultiplier(run)
    if (!Number.isFinite(base) || base < 0 || multiplier == null) return undefined
    const result = base * multiplier
    return Number.isFinite(result) ? result : undefined
  }
  function baseCostFormula(run: RelayChannelProbeRunDto) {
    const breakdown = run.costBreakdown
    if (!breakdown) return ''
    if (breakdown.pricingType === 'per-request')
      return i18ns.t('relay.channelProbePerRequestCostFormula', {
        fixed: formatNumber(breakdown.fixedPrice),
        global: formatNumber(breakdown.globalMultiplier),
        time: formatNumber(breakdown.timeMultiplier),
        raw: formatNumber(breakdown.rawCost),
        base: formatNumber(run.baseLocalCost),
      })
    return i18ns.t('relay.channelProbeTokenCostFormula', {
      input: formatNumber(breakdown.billableInputTokens),
      inputRate: formatNumber(breakdown.inputRate),
      cacheCreation: formatNumber(run.cacheCreationTokens),
      cacheCreationMultiplier: formatNumber(breakdown.cacheCreationMultiplier),
      cacheRead: formatNumber(run.cacheReadTokens),
      cacheReadMultiplier: formatNumber(breakdown.cacheReadMultiplier),
      output: formatNumber(run.responseTokens),
      outputRate: formatNumber(breakdown.outputRate),
      global: formatNumber(breakdown.globalMultiplier),
      time: formatNumber(breakdown.timeMultiplier),
      raw: formatNumber(breakdown.rawCost),
      base: formatNumber(run.baseLocalCost),
    })
  }
  function formatUsage(usage: Record<string, unknown>) {
    return JSON.stringify(usage, null, 2)
  }
  function multiplierChange(draft: ApplyMultiplierDraft) {
    return draft.targetMultiplier - draft.currentMultiplier
  }
  function multiplierChangePercent(draft: ApplyMultiplierDraft) {
    return multiplierRelativeChangePercent(draft.currentMultiplier, draft.targetMultiplier)
  }
  function formatMultiplierChange(draft: ApplyMultiplierDraft) {
    const value = multiplierChange(draft)
    return (value > 0 ? '+' : '') + formatNumber(value) + 'x'
  }
  function formatMultiplierChangePercent(draft: ApplyMultiplierDraft) {
    const value = multiplierChangePercent(draft)
    return Number.isFinite(value) ? value.toFixed(2) + '%' : '∞'
  }
  function multiplierChangeClass(draft: ApplyMultiplierDraft) {
    const value = multiplierChange(draft)
    return value > 0 ? 'multiplier-change-up' : value < 0 ? 'multiplier-change-down' : ''
  }
  function multiplierDirectionClass(currentMultiplier: number, targetMultiplier: number) {
    if (targetMultiplier > currentMultiplier) return 'multiplier-direction-fill-increase'
    if (targetMultiplier < currentMultiplier) return 'multiplier-direction-fill-decrease'
    return 'multiplier-direction-fill-neutral'
  }
  function multiplierRelativeChangePercent(currentMultiplier: number, targetMultiplier: number) {
    if (!currentMultiplier)
      return targetMultiplier === currentMultiplier ? 0 : Number.POSITIVE_INFINITY
    return (Math.abs(targetMultiplier - currentMultiplier) / Math.abs(currentMultiplier)) * 100
  }
  function maximumMultiplierRelativeChange(values: ReadonlyArray<readonly [number, number]>) {
    return values.reduce((maximum, [currentMultiplier, targetMultiplier]) => {
      const relativeChange = multiplierRelativeChangePercent(currentMultiplier, targetMultiplier)
      return Number.isFinite(relativeChange) ? Math.max(maximum, relativeChange) : maximum
    }, 0)
  }
  function multiplierDirectionStyle(
    currentMultiplier: number,
    targetMultiplier: number,
    maximumRelativeChange: number,
  ) {
    const delta = targetMultiplier - currentMultiplier
    const relativeChange = multiplierRelativeChangePercent(currentMultiplier, targetMultiplier)
    const halfWidth = !Number.isFinite(relativeChange)
      ? 50
      : maximumRelativeChange > 0
        ? Math.min(relativeChange / maximumRelativeChange, 1) * 50
        : 0
    return {
      width: String(halfWidth) + '%',
      left: String(delta < 0 ? 50 - halfWidth : 50) + '%',
    }
  }
  function multiplierDirectionLabel(currentMultiplier: number, targetMultiplier: number) {
    const direction =
      targetMultiplier > currentMultiplier
        ? i18ns.t('relay.channelProbePriceIncrease')
        : targetMultiplier < currentMultiplier
          ? i18ns.t('relay.channelProbePriceDecrease')
          : i18ns.t('relay.channelProbeCurrentMultiplier')
    return [
      direction,
      formatNumber(currentMultiplier) + 'x',
      '->',
      formatNumber(targetMultiplier) + 'x',
    ].join(' ')
  }
  function exportMultiplierChangeChart(
    sourceRows: MultiplierChangeRow[] = publicMultiplierChangeRows.value,
  ) {
    const rows = sourceRows.slice(0, 20)
    if (!rows.length) {
      ElMessage.warning(i18ns.t('relay.channelProbeExportChangeChartNoPublic'))
      return
    }

    const canvas = document.createElement('canvas')
    const chartWidth = 1600
    const rowHeight = 66
    const chartHeight = 180 + rows.length * rowHeight
    canvas.width = chartWidth
    canvas.height = chartHeight
    const context = canvas.getContext('2d')
    if (!context) {
      ElMessage.error(i18ns.t('operationFailed'))
      return
    }

    const rootStyle = getComputedStyle(document.documentElement)
    const color = (name: string, fallback: string) =>
      rootStyle.getPropertyValue(name).trim() || fallback
    const textPrimary = color('--el-text-color-primary', '#1f2937')
    const textSecondary = color('--el-text-color-secondary', '#667085')
    const line = color('--el-border-color-lighter', '#e4e7ed')
    const decrease = color('--el-color-success', '#16a34a')
    const decreaseMuted = color('--el-color-success-light-8', '#dcfce7')
    const increase = color('--el-color-danger', '#dc2626')
    const increaseMuted = color('--el-color-danger-light-8', '#fee2e2')
    const neutral = color('--el-fill-color-light', '#f3f4f6')
    const maximum = maximumMultiplierRelativeChange(
      rows.map((row) => [row.sourceMultiplier, row.targetMultiplier] as const),
    )
    const axisStart = 610
    const axisWidth = 720
    const axisCenter = axisStart + axisWidth / 2

    context.fillStyle = color('--el-bg-color', '#ffffff')
    context.fillRect(0, 0, chartWidth, chartHeight)
    context.fillStyle = textPrimary
    context.font = '700 34px Microsoft YaHei, sans-serif'
    context.fillText(i18ns.t('relay.channelProbeExportChangeChartTitle'), 72, 68)
    context.fillStyle = textSecondary
    context.font = '20px Microsoft YaHei, sans-serif'
    context.fillText(i18ns.t('relay.channelProbeExportChangeChartSubtitle'), 72, 106)
    context.fillText(new Date().toLocaleString(), chartWidth - 300, 106)

    context.font = '600 18px Microsoft YaHei, sans-serif'
    context.fillStyle = decrease
    context.fillText(i18ns.t('relay.channelProbePriceDecrease'), axisStart, 146)
    context.fillStyle = textSecondary
    context.textAlign = 'center'
    context.fillText(i18ns.t('relay.channelProbeCurrentMultiplier'), axisCenter, 146)
    context.fillStyle = increase
    context.textAlign = 'right'
    context.fillText(i18ns.t('relay.channelProbePriceIncrease'), axisStart + axisWidth, 146)
    context.textAlign = 'left'

    rows.forEach((row, index) => {
      const top = 180 + index * rowHeight
      const changePercent = multiplierRelativeChangePercent(
        row.sourceMultiplier,
        row.targetMultiplier,
      )
      const isDecrease = row.targetMultiplier < row.sourceMultiplier
      const isIncrease = row.targetMultiplier > row.sourceMultiplier
      const relativeWidth = !Number.isFinite(changePercent)
        ? axisWidth / 2
        : maximum > 0
          ? Math.min(changePercent / maximum, 1) * (axisWidth / 2)
          : 0
      const fillStart = isDecrease ? axisCenter - relativeWidth : axisCenter
      const label = isDecrease
        ? i18ns.t('relay.channelProbePriceDecrease')
        : isIncrease
          ? i18ns.t('relay.channelProbePriceIncrease')
          : i18ns.t('relay.channelProbeCurrentMultiplier')

      context.strokeStyle = line
      context.lineWidth = 1
      context.beginPath()
      context.moveTo(72, top + rowHeight - 8)
      context.lineTo(chartWidth - 72, top + rowHeight - 8)
      context.stroke()
      context.fillStyle = textPrimary
      context.font = '600 21px Microsoft YaHei, sans-serif'
      context.fillText(row.channelName.slice(0, 32), 72, top + 24)
      context.fillStyle = textSecondary
      context.font = '18px Microsoft YaHei, sans-serif'
      context.fillText(
        formatNumber(row.sourceMultiplier) + 'x  ->  ' + formatNumber(row.targetMultiplier) + 'x',
        72,
        top + 50,
      )

      context.fillStyle = decreaseMuted
      context.fillRect(axisStart, top + 25, axisWidth / 2, 12)
      context.fillStyle = neutral
      context.fillRect(axisCenter - 2, top + 25, 4, 12)
      context.fillStyle = increaseMuted
      context.fillRect(axisCenter, top + 25, axisWidth / 2, 12)
      context.fillStyle = isDecrease ? decrease : isIncrease ? increase : textSecondary
      context.fillRect(fillStart, top + 25, relativeWidth, 12)
      context.fillStyle = textPrimary
      context.fillRect(axisCenter - 2, top + 21, 4, 20)

      context.fillStyle = isDecrease ? decrease : isIncrease ? increase : textSecondary
      context.font = '600 19px Microsoft YaHei, sans-serif'
      context.textAlign = 'right'
      context.fillText(
        label + ' ' + (Number.isFinite(changePercent) ? changePercent.toFixed(2) + '%' : '∞'),
        chartWidth - 72,
        top + 38,
      )
      context.textAlign = 'left'
    })

    canvas.toBlob((blob) => {
      if (!blob) {
        ElMessage.error(i18ns.t('operationFailed'))
        return
      }
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'service-price-adjustments-' + new Date().toISOString().slice(0, 10) + '.png'
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 0)
      ElMessage.success(i18ns.t('relay.channelProbeExportChangeCharted'))
    }, 'image/png')
  }
  function formatChangeValue(value: number) {
    return (value > 0 ? '+' : '') + formatNumber(value) + 'x'
  }
  function appliedDraftChangeRows(drafts: ApplyMultiplierDraft[]): MultiplierChangeRow[] {
    const itemByChannelId = new Map(items.value.map((item) => [item.channelId, item]))
    return drafts.flatMap((draft) => {
      const item = itemByChannelId.get(draft.run.relayChannelId)
      if (!item) return []
      const change = draft.targetMultiplier - draft.currentMultiplier
      return [
        {
          channelId: item.channelId,
          channelName: item.channelName,
          customerFacingTargets: item.customerFacingTargets,
          sourceMultiplier: draft.currentMultiplier,
          targetMultiplier: draft.targetMultiplier,
          change,
          changePercent: multiplierRelativeChangePercent(
            draft.currentMultiplier,
            draft.targetMultiplier,
          ),
          applied: true,
          costFactors:
            formatNumber(draft.run.upstreamRateMultiplier) +
            ' × ' +
            formatNumber(draft.run.distributionMultiplier),
          targetCost: targetLocalCost(draft.run),
          time: new Date(),
        },
      ]
    })
  }
  function onApplySelectionChange(rows: ApplyMultiplierDraft[]) {
    selectedApplyRunIds.value = rows.map((row) => row.run.id)
  }
  function clearDraftSelection() {
    applyTableRef.value?.clearSelection()
    selectedApplyRunIds.value = []
  }
  function isEligibleDraft(draft: ApplyMultiplierDraft) {
    const change = multiplierChange(draft)
    const directionMatches =
      selectionDirection.value === 'all' ||
      (selectionDirection.value === 'increase' && change > 0) ||
      (selectionDirection.value === 'decrease' && change < 0)
    return directionMatches && multiplierChangePercent(draft) > selectionTolerancePercent.value
  }
  async function selectEligibleDrafts() {
    clearDraftSelection()
    await nextTick()
    for (const draft of applyDrafts.value)
      if (isEligibleDraft(draft)) applyTableRef.value?.toggleRowSelection(draft, true)
  }
  function parseObject(value: string, label: string): Record<string, unknown> {
    try {
      const parsed: unknown = JSON.parse(value || '{}')
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error()
      return parsed as Record<string, unknown>
    } catch {
      throw new Error(`${label}: ${i18ns.t('relay.channelProbeInvalidJson')}`)
    }
  }
  function makeKeyValueEntries(
    value: Record<string, unknown> | undefined,
    body = false,
  ): ProbeKeyValueEntry[] {
    return Object.entries(value ?? {}).map(([key, entryValue]) => {
      const valueType =
        body && typeof entryValue === 'number'
          ? 'number'
          : body && typeof entryValue === 'boolean'
            ? 'boolean'
            : body && entryValue !== null && typeof entryValue === 'object'
              ? 'json'
              : 'text'
      return {
        id: crypto.randomUUID(),
        key,
        value: valueType === 'json' ? JSON.stringify(entryValue) : String(entryValue ?? ''),
        valueType,
      }
    })
  }
  function ensureUniqueFieldKey(key: string, target: Record<string, unknown>, label: string) {
    if (!key.trim() || Object.prototype.hasOwnProperty.call(target, key.trim()))
      throw new Error(i18ns.t('relay.channelProbeInvalidField', { label }))
  }
  function textFields(entries: ProbeKeyValueEntry[], label: string): Record<string, string> {
    const result: Record<string, string> = {}
    for (const entry of entries) {
      if (!entry.key.trim() && !entry.value.trim()) continue
      ensureUniqueFieldKey(entry.key, result, label)
      result[entry.key.trim()] = entry.value
    }
    return result
  }
  function bodyFields(entries: ProbeKeyValueEntry[]): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    for (const entry of entries) {
      if (!entry.key.trim() && !entry.value.trim()) continue
      ensureUniqueFieldKey(entry.key, result, i18ns.t('relay.channelProbeBody'))
      const value = entry.value.trim()
      if (entry.valueType === 'text') result[entry.key.trim()] = entry.value
      else if (entry.valueType === 'number') {
        const numeric = Number(value)
        if (!Number.isFinite(numeric))
          throw new Error(i18ns.t('relay.channelProbeInvalidField', { label: entry.key }))
        result[entry.key.trim()] = numeric
      } else if (entry.valueType === 'boolean') {
        if (value !== 'true' && value !== 'false')
          throw new Error(i18ns.t('relay.channelProbeInvalidField', { label: entry.key }))
        result[entry.key.trim()] = value === 'true'
      } else {
        try {
          result[entry.key.trim()] = JSON.parse(value)
        } catch {
          throw new Error(`${entry.key}: ${i18ns.t('relay.channelProbeInvalidJson')}`)
        }
      }
    }
    return result
  }
  function formWorkflow(): RelayChannelProbeWorkflowStepDto[] {
    const balanceCount = workflowSteps.value.filter((step) => step.balancePath.trim()).length
    if (workflowSteps.value.length < 1 || balanceCount !== 1)
      throw new Error(i18ns.t('relay.channelProbeBalancePathRequired'))
    return workflowSteps.value.map((step) => {
      if (!/^[A-Za-z][A-Za-z0-9_]{0,49}$/.test(step.name) || !step.url.trim())
        throw new Error(i18ns.t('relay.channelProbeInvalidStep'))
      return {
        name: step.name,
        method: step.method,
        url: step.url,
        headers: textFields(step.headers, i18ns.t('relay.channelProbeHeaders')),
        query: textFields(step.query, i18ns.t('relay.channelProbeQuery')),
        body: bodyFields(step.body),
        extract: textFields(step.extract, i18ns.t('relay.channelProbeExtract')),
        ...(step.balancePath.trim() ? { balancePath: step.balancePath.trim() } : {}),
      }
    })
  }
  function resolveCustomerFacingTargets(
    channels: RelayChannelDto[],
    standaloneChannelId: string,
  ): RelayChannelProbeCustomerFacingTargetDto[] {
    const channelById = new Map(channels.map((channel) => [channel.id, channel]))
    const targetById = new Map<string, RelayChannelProbeCustomerFacingTargetDto>()
    const collectStandaloneMembers = (channelId: string, path = new Set<string>()): string[] => {
      if (path.has(channelId)) return []
      const channel = channelById.get(channelId)
      if (!channel?.enabled) return []
      if (channel.channelType === 'standalone') return [channel.id]
      const nextPath = new Set(path).add(channelId)
      return (channel.poolMembers ?? []).flatMap((member) => {
        if (member.enabled === false || member.memberChannelEnabled === false) return []
        return collectStandaloneMembers(member.memberChannelId, nextPath)
      })
    }
    for (const channel of channels) {
      if (!channel.enabled || channel.channelType !== 'pooled') continue
      if (collectStandaloneMembers(channel.id).includes(standaloneChannelId)) {
        targetById.set(channel.id, { channelId: channel.id, channelName: channel.name })
      }
    }
    if (!targetById.size) {
      const standalone = channelById.get(standaloneChannelId)
      if (standalone?.enabled)
        targetById.set(standalone.id, { channelId: standalone.id, channelName: standalone.name })
    }
    return [...targetById.values()]
  }
  async function loadOverview() {
    const requestId = ++overviewRequest
    loading.value = true
    pageError.value = ''
    try {
      const result = await relayChannelProbeService.listOverview()
      let overviewItems = result.items
      if (!result.hasCustomerFacingTargets) {
        const channels =
          legacyChannelTopology.value ??
          (await relayChannelService.listChannels({ includeDisabled: true }))
        legacyChannelTopology.value = channels
        overviewItems = overviewItems.map((item) => ({
          ...item,
          customerFacingTargets: resolveCustomerFacingTargets(channels, item.channelId),
        }))
      }
      if (requestId === overviewRequest) items.value = overviewItems
    } catch (error) {
      if (requestId === overviewRequest) {
        pageError.value = getErrorMessage(error, i18ns.t('operationFailed'))
        ElMessage.error(pageError.value)
      }
    } finally {
      if (requestId === overviewRequest) loading.value = false
    }
  }
  function updateChannelItem(
    channelId: string,
    update: (item: RelayChannelProbeOverviewItemDto) => RelayChannelProbeOverviewItemDto,
  ) {
    const index = items.value.findIndex((item) => item.channelId === channelId)
    if (index < 0) return
    const next = update(items.value[index]!)
    items.value.splice(index, 1, next)
    if (selected.value?.channelId === channelId) selected.value = next
  }
  function syncSelectedLatestRun() {
    const channelId = selected.value?.channelId
    if (!channelId) return
    updateChannelItem(channelId, (item) => ({ ...item, latestRun: runs.value[0] }))
  }
  async function openDrawer(row: RelayChannelProbeOverviewItemDto) {
    // Complete the drawer render before starting any remote request. A slow or stalled
    // run-history request must never delay the management surface becoming usable.
    ++runsRequest
    runs.value = []
    selected.value = row
    drawerOpen.value = true
    tab.value = 'profile'
    const profile = row.profile
    form.value = profile
      ? {
          enabled: profile.enabled,
          probeFormat: profile.probeFormat,
          probeEndpoint: profile.probeEndpoint,
          cacheMode: profile.cacheMode,
          sampleCount: profile.sampleCount,
          strictCalibrationValidation: profile.strictCalibrationValidation,
          measurementInputTokens: profile.measurementInputTokens,
          balanceSettlementTolerance: profile.balanceSettlementTolerance,
          balanceSettlementReads: profile.balanceSettlementReads,
          probeModel: profile.probeModel,
          distributionMultiplier: profile.distributionMultiplier,
          upstreamCurrency: profile.upstreamCurrency,
          localCurrency: profile.localCurrency,
          upstreamBalanceDivisor: profile.upstreamBalanceDivisor,
          upstreamRateMultiplier: profile.upstreamRateMultiplier,
          probeGroup: profile.probeGroup ?? '',
        }
      : {
          ...emptyForm(),
          probeFormat: row.allowedProbeFormats[0] ?? 'openai-chat-completions',
          probeEndpoint: defaultEndpointForFormat(
            row.allowedProbeFormats[0] ?? 'openai-chat-completions',
          ),
        }
    payloadText.value = JSON.stringify(
      profile?.probePayload ??
        createDefaultProbePayload(form.value.probeFormat, form.value.probeEndpoint),
      null,
      2,
    )
    workflowSteps.value = profile ? profile.workflow.map(toWorkflowForm) : [makeStep()]
    credentialNames.value = profile?.credentialNames ?? []
    credentials.value = []
    await nextTick()
    void loadRuns()
    startPolling()
  }
  function toWorkflowForm(step: RelayChannelProbeWorkflowStepDto): WorkflowFormStep {
    return {
      id: crypto.randomUUID(),
      name: step.name,
      method: step.method,
      openSections: [
        ...(Object.keys(step.headers || {}).length ||
        Object.keys(step.query || {}).length ||
        Object.keys(step.body || {}).length
          ? ['request']
          : []),
        ...(Object.keys(step.extract || {}).length ? ['response'] : []),
      ],
      url: step.url,
      headers: makeKeyValueEntries(step.headers),
      query: makeKeyValueEntries(step.query),
      body: makeKeyValueEntries(step.body, true),
      extract: makeKeyValueEntries(step.extract),
      balancePath: step.balancePath ?? '',
    }
  }
  function resetDrawer() {
    ++runsRequest
    selected.value = null
    runs.value = []
    credentials.value = []
    runsLoading.value = false
  }
  async function loadRuns() {
    if (!selected.value) return
    const requestId = ++runsRequest
    runsLoading.value = true
    try {
      const result = await relayChannelProbeService.listRuns(selected.value.channelId)
      if (requestId === runsRequest) {
        runs.value = result.items
        syncSelectedLatestRun()
      }
    } catch (error) {
      if (requestId === runsRequest)
        ElMessage.error(getErrorMessage(error, i18ns.t('operationFailed')))
    } finally {
      if (requestId === runsRequest) runsLoading.value = false
    }
  }
  async function saveProfile() {
    if (!selected.value || saving.value) return
    if (!form.value.probeModel.trim())
      return ElMessage.warning(i18ns.t('relay.channelProbeModelRequired'))
    const credentialMap = credentials.value.reduce<Record<string, string>>((result, row) => {
      if (row.name.trim() && row.value) result[row.name.trim()] = row.value
      return result
    }, {})
    if (credentials.value.some((row) => Boolean(row.name.trim()) !== Boolean(row.value)))
      return ElMessage.warning(i18ns.t('relay.channelProbeCredentialIncomplete'))
    saving.value = true
    try {
      const profile = await relayChannelProbeService.saveProfile(selected.value.channelId, {
        ...form.value,
        upstreamCurrency: form.value.upstreamCurrency.toUpperCase(),
        localCurrency: form.value.localCurrency.toUpperCase(),
        probePayload: parseObject(payloadText.value, i18ns.t('relay.channelProbePayload')),
        workflow: formWorkflow(),
        ...(Object.keys(credentialMap).length ? { credentials: credentialMap } : {}),
      })
      ElMessage.success(i18ns.t('success'))
      updateChannelItem(selected.value.channelId, (item) => ({ ...item, profile }))
      credentialNames.value = profile.credentialNames
      credentials.value = []
    } catch (error) {
      ElMessage.error(getErrorMessage(error, i18ns.t('operationFailed')))
    } finally {
      saving.value = false
    }
  }
  async function confirmClearProfile() {
    const channelId = selected.value?.channelId
    if (!channelId || !selected.value?.profile || clearingProfile.value) return
    try {
      await ElMessageBox.confirm(
        i18ns.t('relay.channelProbeClearProfileConfirm'),
        i18ns.t('warning'),
        {
          type: 'warning',
          confirmButtonText: i18ns.t('confirm'),
          cancelButtonText: i18ns.t('cancel'),
        },
      )
    } catch {
      return
    }
    clearingProfile.value = true
    try {
      await relayChannelProbeService.clearProfile(channelId)
      ElMessage.success(i18ns.t('relay.channelProbeProfileCleared'))
      updateChannelItem(channelId, (item) => ({ ...item, profile: undefined }))
      credentialNames.value = []
      credentials.value = []
    } catch (error) {
      ElMessage.error(getErrorMessage(error, i18ns.t('operationFailed')))
    } finally {
      clearingProfile.value = false
    }
  }
  async function run(row: RelayChannelProbeOverviewItemDto) {
    if (runningId.value) return
    runningId.value = row.channelId
    try {
      const queued = await relayChannelProbeService.createRun(row.channelId, {
        forceWithoutCacheBuster: forceWithoutCacheBuster.value,
      })
      ElMessage.success(i18ns.t('relay.channelProbeQueued'))
      updateChannelItem(row.channelId, (item) => ({ ...item, latestRun: queued }))
      if (selected.value?.channelId === row.channelId) await loadRuns()
      startPolling()
    } catch (error) {
      ElMessage.error(getErrorMessage(error, i18ns.t('operationFailed')))
    } finally {
      runningId.value = ''
    }
  }
  async function confirmResetRunState(row: RelayChannelProbeOverviewItemDto) {
    if (resettingChannelId.value) return
    try {
      await ElMessageBox.confirm(
        i18ns.t('relay.channelProbeResetStateConfirm'),
        i18ns.t('warning'),
        {
          type: 'warning',
          confirmButtonText: i18ns.t('confirm'),
          cancelButtonText: i18ns.t('cancel'),
        },
      )
    } catch {
      return
    }
    resettingChannelId.value = row.channelId
    try {
      await relayChannelProbeService.resetRunState(row.channelId)
      ElMessage.success(i18ns.t('relay.channelProbeStateReset'))
      if (selected.value?.channelId === row.channelId) await loadRuns()
    } catch (error) {
      ElMessage.error(getErrorMessage(error, i18ns.t('operationFailed')))
    } finally {
      resettingChannelId.value = ''
    }
  }
  async function confirmClearRunHistory(scope: 'all' | 'failed') {
    const channelId = selected.value?.channelId
    if (!channelId || clearingHistoryScope.value) return
    try {
      await ElMessageBox.confirm(
        i18ns.t(
          scope === 'all'
            ? 'relay.channelProbeClearHistoryConfirm'
            : 'relay.channelProbeClearFailuresConfirm',
        ),
        i18ns.t('warning'),
        {
          type: 'warning',
          confirmButtonText: i18ns.t('confirm'),
          cancelButtonText: i18ns.t('cancel'),
        },
      )
    } catch {
      return
    }
    clearingHistoryScope.value = scope
    try {
      const result = await relayChannelProbeService.clearRunHistory(channelId, scope)
      ElMessage.success(i18ns.t('relay.channelProbeHistoryCleared', { count: result.deleted }))
      await loadRuns()
    } catch (error) {
      ElMessage.error(getErrorMessage(error, i18ns.t('operationFailed')))
    } finally {
      clearingHistoryScope.value = ''
    }
  }
  async function confirmBatchRun() {
    const channelIds = runnableChannelIds.value
    if (!channelIds.length || batchRunning.value) return
    try {
      await ElMessageBox.confirm(
        i18ns.t('relay.channelProbeBatchRunConfirm', { count: channelIds.length }),
        i18ns.t('warning'),
        {
          type: 'warning',
          confirmButtonText: i18ns.t('confirm'),
          cancelButtonText: i18ns.t('cancel'),
        },
      )
    } catch {
      return
    }
    batchRunning.value = true
    try {
      const result = await relayChannelProbeService.createRuns({
        channelIds,
        forceWithoutCacheBuster: forceWithoutCacheBuster.value,
      })
      if (result.queued.length)
        ElMessage.success(i18ns.t('relay.channelProbeBatchQueued', { count: result.queued.length }))
      if (result.rejected.length)
        ElMessage.warning(result.rejected.map((item: { reason: string }) => item.reason).join('；'))
      clearSelection()
      for (const run of result.queued)
        updateChannelItem(run.relayChannelId, (item) => ({ ...item, latestRun: run }))
      if (
        selected.value &&
        result.queued.some(
          (run: { relayChannelId: string }) => run.relayChannelId === selected.value?.channelId,
        )
      )
        await loadRuns()
      startPolling()
    } catch (error) {
      ElMessage.error(getErrorMessage(error, i18ns.t('operationFailed')))
    } finally {
      batchRunning.value = false
    }
  }
  function openBatchProfileDialog() {
    batchProfileSourceChannelId.value = batchProfileSources.value[0]?.channelId ?? ''
    batchProfileOverwriteExisting.value = false
    batchProfileDialogOpen.value = true
  }
  function resetBatchProfileDialog() {
    batchProfileSourceChannelId.value = ''
    batchProfileOverwriteExisting.value = false
    batchProfileSaving.value = false
  }
  async function submitBatchProfileCopy() {
    const sourceChannelId = batchProfileSourceChannelId.value
    const targetChannelIds = batchProfileTargets.value.map((row) => row.channelId)
    if (!sourceChannelId || !targetChannelIds.length || batchProfileSaving.value) return
    batchProfileSaving.value = true
    try {
      const result = await relayChannelProbeService.copyProfile({
        sourceChannelId,
        targetChannelIds,
        overwriteExisting: batchProfileOverwriteExisting.value,
      })
      for (const profile of result.copied)
        updateChannelItem(profile.relayChannelId, (item) => ({ ...item, profile }))
      if (result.copied.length)
        ElMessage.success(
          i18ns.t('relay.channelProbeBatchConfigured', { count: result.copied.length }),
        )
      if (result.rejected.length)
        ElMessage.warning(result.rejected.map((item: { reason: string }) => item.reason).join('；'))
      if (!result.rejected.length) batchProfileDialogOpen.value = false
    } catch (error) {
      ElMessage.error(getErrorMessage(error, i18ns.t('operationFailed')))
    } finally {
      batchProfileSaving.value = false
    }
  }
  async function confirmApply(runIds: string[]) {
    if (!runIds.length || applying.value) return
    const drafts = getApplicableRuns(runIds)
    if (!drafts.length) return ElMessage.warning(i18ns.t('relay.channelProbeApplyUnavailable'))
    applyDrafts.value = drafts
    exportAppliedChangeChart.value = false
    forceLargeMultiplierChange.value = false
    roundDraftMultipliers()
    applyDialogOpen.value = true
    await nextTick()
    await selectEligibleDrafts()
  }
  async function submitApplyMultipliers() {
    const selectedDrafts = applyDrafts.value.filter((draft) =>
      selectedApplyRunIds.value.includes(draft.run.id),
    )
    if (!selectedDrafts.length || applying.value)
      return ElMessage.warning(i18ns.t('relay.channelProbeSelectionRequired'))
    if (
      selectedDrafts.some(
        (draft) =>
          !Number.isFinite(draft.targetMultiplier) ||
          draft.targetMultiplier < 0.000001 ||
          draft.targetMultiplier > 1000,
      )
    )
      return ElMessage.warning(i18ns.t('relay.channelProbeTargetMultiplierInvalid'))
    const runIds = selectedDrafts.map((draft) => draft.run.id)
    const targetMultiplierByRunId = new Map(
      selectedDrafts.map((draft) => [draft.run.id, draft.targetMultiplier]),
    )
    applying.value = true
    try {
      const result = await relayChannelProbeService.applyRuns({
        runIds,
        forceLargeChange: forceLargeMultiplierChange.value,
        overrides: selectedDrafts.map((draft) => ({
          runId: draft.run.id,
          multiplier: draft.targetMultiplier,
        })),
      })
      if (result.applied)
        ElMessage.success(i18ns.t('relay.channelProbeApplied', { count: result.applied }))
      if (result.rejected.length)
        ElMessage.warning(result.rejected.map((item: { reason: string }) => item.reason).join('；'))
      const rejectedRunIds = new Set(result.rejected.map((item: { runId: string }) => item.runId))
      const appliedRunIds = runIds.filter((runId) => !rejectedRunIds.has(runId))
      const appliedDrafts = selectedDrafts.filter((draft) => appliedRunIds.includes(draft.run.id))
      for (const runId of appliedRunIds) {
        const draft = applyDrafts.value.find((item) => item.run.id === runId)
        const targetMultiplier = targetMultiplierByRunId.get(runId)
        if (!draft || targetMultiplier == null) continue
        updateChannelItem(draft.run.relayChannelId, (item) => ({
          ...item,
          multiplier: targetMultiplier,
          latestRun:
            item.latestRun?.id === runId
              ? {
                  ...item.latestRun,
                  appliedMultiplier: targetMultiplier,
                  appliedAt: new Date().toISOString(),
                }
              : item.latestRun,
        }))
      }
      if (
        selected.value &&
        appliedRunIds.some((runId) => runs.value.some((run) => run.id === runId))
      )
        await loadRuns()
      if (exportAppliedChangeChart.value && appliedDrafts.length)
        exportMultiplierChangeChart(
          toCustomerFacingMultiplierChangeRows(appliedDraftChangeRows(appliedDrafts)),
        )
      const remainingDrafts = applyDrafts.value.filter(
        (draft) => !appliedRunIds.includes(draft.run.id),
      )
      if (remainingDrafts.length) {
        applyDrafts.value = remainingDrafts
        selectedApplyRunIds.value = remainingDrafts
          .filter((draft) => rejectedRunIds.has(draft.run.id))
          .map((draft) => draft.run.id)
      } else {
        applyDialogOpen.value = false
        applyDrafts.value = []
        selectedApplyRunIds.value = []
        forceLargeMultiplierChange.value = false
        clearSelection()
      }
    } catch (error) {
      ElMessage.error(getErrorMessage(error, i18ns.t('operationFailed')))
    } finally {
      applying.value = false
    }
  }
  function schedulePolling() {
    if (!pollingEnabled || polling || pollTimer || !hasActiveProbeRuns.value) return
    pollTimer = setTimeout(async () => {
      pollTimer = undefined
      if (!pollingEnabled || !hasActiveProbeRuns.value) return
      polling = true
      try {
        const refreshes = [loadOverview()]
        if (
          selected.value &&
          (selected.value.latestRun?.status === 'queued' ||
            selected.value.latestRun?.status === 'running')
        )
          refreshes.push(loadRuns())
        await Promise.all(refreshes)
      } finally {
        polling = false
        schedulePolling()
      }
    }, 3000)
  }
  function startPolling() {
    if (!hasActiveProbeRuns.value) return
    pollingEnabled = true
    schedulePolling()
  }
  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer)
    pollTimer = undefined
    pollingEnabled = false
  }
  watch([keyword, profileFilter, enabledFilter, runStatusFilter, suggestionFilter], clearSelection)
  watch(hasActiveProbeRuns, (active) => {
    if (active) startPolling()
    else stopPolling()
  })
  watch(
    [() => form.value.probeFormat, () => form.value.probeEndpoint],
    ([format, endpoint], [previousFormat, previousEndpoint]) => {
      if (!probeEndpointOptions.value.includes(endpoint)) {
        form.value.probeEndpoint = defaultEndpointForFormat(format)
        return
      }
      // Only migrate a generated preset. Custom JSON can carry upstream-specific
      // fields and must never be overwritten by a format switch.
      if (
        previousFormat !== undefined &&
        previousEndpoint !== undefined &&
        isPayloadPreset(previousFormat, previousEndpoint)
      )
        payloadText.value = JSON.stringify(createDefaultProbePayload(format, endpoint), null, 2)
    },
  )
  watch(
    [
      changeSort,
      changeDirection,
      changeTypeFilter,
      changeMinimumPercent,
      changeDisplayDigits,
      changeDisplayRoundingMode,
      changePageSize,
    ],
    () => {
      changePage.value = 1
    },
  )
  onMounted(() => {
    try {
      const saved = TypedLocalStorage.getItem(APPLY_SETTINGS_STORAGE_KEY)
      if (saved) {
        const settings = JSON.parse(saved) as Partial<RememberedApplySettings>
        if (settings.roundingMode === 'ceil' || settings.roundingMode === 'nearest')
          roundingMode.value = settings.roundingMode
        if (
          Number.isInteger(settings.roundingDigits) &&
          settings.roundingDigits! >= 0 &&
          settings.roundingDigits! <= 6
        )
          roundingDigits.value = settings.roundingDigits!
        if (
          Number.isFinite(settings.selectionTolerancePercent) &&
          settings.selectionTolerancePercent! >= 0 &&
          settings.selectionTolerancePercent! <= 100
        )
          selectionTolerancePercent.value = settings.selectionTolerancePercent!
        if (
          settings.selectionDirection === 'all' ||
          settings.selectionDirection === 'increase' ||
          settings.selectionDirection === 'decrease'
        )
          selectionDirection.value = settings.selectionDirection
        rememberApplySettings.value = true
      }
    } catch {
      TypedLocalStorage.removeItem(APPLY_SETTINGS_STORAGE_KEY)
    }
    void loadOverview()
  })
  onBeforeUnmount(stopPolling)

  return {
    permissionStore,
    canExecute,
    canAdjust,
    loading,
    saving,
    clearingProfile,
    applying,
    applyDialogOpen,
    exportAppliedChangeChart,
    forceLargeMultiplierChange,
    roundingDigits,
    roundingMode,
    applyDrafts,
    applyTableRef,
    selectedApplyRunIds,
    hasLargeMultiplierChange,
    selectionTolerancePercent,
    selectionDirection,
    rememberApplySettings,
    APPLY_SETTINGS_STORAGE_KEY,
    changeDialogOpen,
    changeSort,
    changeDirection,
    changeTypeFilter,
    changeMinimumPercent,
    changeDisplayDigits,
    changeDisplayRoundingMode,
    changePage,
    changePageSize,
    batchRunning,
    batchProfileDialogOpen,
    batchProfileSaving,
    batchProfileSourceChannelId,
    batchProfileOverwriteExisting,
    runsLoading,
    runningId,
    resettingChannelId,
    clearingHistoryScope,
    forceWithoutCacheBuster,
    pageError,
    items,
    legacyChannelTopology,
    selected,
    drawerOpen,
    tab,
    runs,
    selectedRows,
    tableRef,
    keyword,
    profileFilter,
    enabledFilter,
    runStatusFilter,
    suggestionFilter,
    runStatuses,
    filteredItems,
    multiplierChangeRows,
    publicMultiplierChangeRows,
    toCustomerFacingMultiplierChangeRows,
    applyDirectionMaximumPercent,
    customerFacingDirectionMaximumPercent,
    pagedCustomerFacingMultiplierChangeRows,
    selectedRuns,
    selectedProbeFormats,
    selectedProbeModels,
    hasActiveProbeRuns,
    runnableChannelIds,
    batchProfileSources,
    batchProfileTargets,
    canBatchCopyProfile,
    form,
    payloadText,
    workflowSteps,
    credentials,
    credentialNames,
    importDialogOpen,
    importText,
    importFileInput,
    balancePathCount,
    currenciesMatch,
    extractedVariableNames,
    requiredCredentialStates,
    availableVariables,
    overviewRequest,
    runsRequest,
    pollTimer,
    emptyForm,
    isProbeFormatAvailable,
    probeEndpointOptions,
    probeEndpointLabel,
    probeEndpointHelp,
    cacheModeHelp,
    sampleStatusLabel,
    calibrationStatusLabel,
    defaultEndpointForFormat,
    makeStep,
    addWorkflowStep,
    removeWorkflowStep,
    addCredential,
    variableTemplate,
    collectVariableReferences,
    copyVariable,
    applyPayloadPreset,
    isPayloadPreset,
    createDefaultProbePayload,
    createProfileExport,
    serializeProfileExport,
    downloadConfiguration,
    copyConfiguration,
    openImportDialog,
    triggerImportFile,
    readImportFile,
    parseImportedProfile,
    validBalanceDivisor,
    validUpstreamRateMultiplier,
    validSampleCount,
    validMeasurementInputTokens,
    validBalanceSettlementTolerance,
    validBalanceSettlementReads,
    applyImportedConfiguration,
    statusLabel,
    formatProbeError,
    statusType,
    formatDate,
    formatNumber,
    isApplicable,
    suggestionUnavailableReason,
    isRunnable,
    canSelectRow,
    onSelectionChange,
    clearSelection,
    getApplicableRuns,
    roundDraftMultipliers,
    roundMultiplierForPrecision,
    targetLocalCost,
    currentChannelMultiplier,
    estimatedCurrentCharge,
    baseCostFormula,
    formatUsage,
    multiplierChange,
    multiplierChangePercent,
    formatMultiplierChange,
    formatMultiplierChangePercent,
    multiplierChangeClass,
    multiplierDirectionClass,
    multiplierRelativeChangePercent,
    maximumMultiplierRelativeChange,
    multiplierDirectionStyle,
    multiplierDirectionLabel,
    exportMultiplierChangeChart,
    formatChangeValue,
    appliedDraftChangeRows,
    onApplySelectionChange,
    clearDraftSelection,
    isEligibleDraft,
    selectEligibleDrafts,
    parseObject,
    makeKeyValueEntries,
    ensureUniqueFieldKey,
    textFields,
    bodyFields,
    formWorkflow,
    resolveCustomerFacingTargets,
    loadOverview,
    updateChannelItem,
    syncSelectedLatestRun,
    openDrawer,
    toWorkflowForm,
    resetDrawer,
    loadRuns,
    saveProfile,
    confirmClearProfile,
    run,
    confirmResetRunState,
    confirmClearRunHistory,
    confirmBatchRun,
    openBatchProfileDialog,
    resetBatchProfileDialog,
    submitBatchProfileCopy,
    confirmApply,
    submitApplyMultipliers,
    startPolling,
    stopPolling,
  }
}

export type RelayChannelProbeManagementState = ReturnType<typeof useRelayChannelProbeManagement>
