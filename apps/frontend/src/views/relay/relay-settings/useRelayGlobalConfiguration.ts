import { ref } from 'vue'
import { i18ns } from '@/locales'
import { ElMessage } from '@/utils/elementPlusRuntime'
import { showRequestErrorNotice } from '@/utils/requestErrorNotice'
import { isTwoFactorRequiredResponse } from '@/service/twoFactorNavigationService'
import { configService } from '@/service/configService'
import { relayConfigService } from '@/service/relayConfigService'
import type {
  RelayChannelTopologyMode,
  SetRelayConfigDto,
  UpdateRelayConfigRequest,
} from '@/client/types.gen'
import {
  MODEL_ID_PATTERN,
  resolveModelId,
  normalizeSupportedFormats,
  serializeSupportedFormats,
  type ModelRateRow,
} from './relayModelRates'

type RelayPayload = Omit<UpdateRelayConfigRequest, 'monitorNameMapping'> & {
  monitorNameMapping?: Record<string, string> | null
}
const showError = (error: unknown, fallback: string) => {
  if (!isTwoFactorRequiredResponse(error)) showRequestErrorNotice(error, fallback)
}
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const clone = <T>(value: T): T => structuredClone(value)

/** Each API has its own loaded snapshot; a filtered pricing response is never a full replacement. */
export function useRelayGlobalConfiguration(afterRelaySave: () => Promise<void>) {
  const loading = ref(false),
    saving = ref(false)
  const relayConfigurationLoaded = ref(false),
    systemRelayConfigurationLoaded = ref(false)
  let relaySnapshot: RelayPayload | null = null
  let systemSnapshot: SetRelayConfigDto | null = null
  const modelRates = ref<ModelRateRow[]>([])
  const globalMultiplier = ref(1),
    uptimeStatusUrl = ref(''),
    enableQueue = ref(true)
  const maxConcurrency = ref(5),
    queueTimeoutSec = ref(30),
    upstreamStreamTimeoutSec = ref(120)
  const preflightBufferLimitMB = ref(2)
  const apiCatalogPoolVisibility = ref<'hidden' | 'anonymous-range'>('anonymous-range')
  const channelTopologyMode = ref<RelayChannelTopologyMode>('legacy')
  const relayCustomKeyEnabled = ref(true),
    relayCustomKeyMaxTokensPerUser = ref(3)
  const relayCustomKeyCreateLimitWindowMinutes = ref(10),
    relayCustomKeyCreateLimitMaxCount = ref(5)
  const relayUpstreamUrl = ref(''),
    relayUpstreamApiKey = ref(''),
    relayAllowedModels = ref('')
  const monitorConfigEnabled = ref(false),
    showOnlyConfigured = ref(false)
  const monitorConfigs = ref<{ monitorId: string; displayName: string }[]>([])

  const currentRelay = (): RelayPayload => {
    const entries = monitorConfigEnabled.value
      ? monitorConfigs.value
          .filter((row) => row.monitorId.trim() && row.displayName.trim())
          .map((row) => [row.monitorId.trim(), row.displayName.trim()] as const)
          .sort(([a], [b]) => a.localeCompare(b))
      : []
    const mapping = entries.length ? Object.fromEntries(entries) : null
    return {
      globalMultiplier: globalMultiplier.value,
      uptimeStatusUrl: uptimeStatusUrl.value,
      monitorNameMapping: mapping,
      showOnlyConfigured: mapping ? showOnlyConfigured.value : false,
      enableQueue: enableQueue.value,
      maxConcurrency: maxConcurrency.value,
      queueTimeout: queueTimeoutSec.value * 1000,
      upstreamStreamTimeout: upstreamStreamTimeoutSec.value * 1000,
      preflightBufferLimitBytes: Math.round(preflightBufferLimitMB.value * 1024 * 1024),
      apiCatalogPoolVisibility: apiCatalogPoolVisibility.value,
      modelRates: modelRates.value
        .filter((row) => row.model.trim())
        .map((row) => ({
          model: row.model.trim(),
          modelId: resolveModelId(row),
          pricingType: row.pricingType || 'token-based',
          inputPrice: row.inputPrice,
          outputPrice: row.outputPrice,
          fixedPrice: row.fixedPrice,
          cacheCreationMultiplier: row.cacheCreationMultiplier,
          cacheReadMultiplier: row.cacheReadMultiplier,
          supportedFormats: serializeSupportedFormats(row.supportedFormats),
        }))
        .sort((a, b) => a.model.localeCompare(b.model)),
    }
  }
  const currentSystem = (): SetRelayConfigDto => ({
    upstreamUrl: relayUpstreamUrl.value,
    upstreamApiKey: relayUpstreamApiKey.value,
    allowedModels: relayAllowedModels.value,
    customKeyEnabled: relayCustomKeyEnabled.value,
    customKeyMaxTokensPerUser: Math.max(0, relayCustomKeyMaxTokensPerUser.value),
    customKeyCreateLimitWindowMinutes: Math.max(1, relayCustomKeyCreateLimitWindowMinutes.value),
    customKeyCreateLimitMaxCount: Math.max(0, relayCustomKeyCreateLimitMaxCount.value),
  })

  const loadConfig = async () => {
    if (loading.value || saving.value) return
    loading.value = true
    relayConfigurationLoaded.value = false
    systemRelayConfigurationLoaded.value = false
    relaySnapshot = null
    systemSnapshot = null
    try {
      await Promise.all([
        (async () => {
          try {
            const config = await relayConfigService.getRelayConfig()
            globalMultiplier.value = config.globalMultiplier
            uptimeStatusUrl.value = config.uptimeStatusUrl || ''
            enableQueue.value = config.enableQueue ?? true
            maxConcurrency.value = config.maxConcurrency ?? 5
            queueTimeoutSec.value = Math.round((config.queueTimeout ?? 30000) / 1000)
            upstreamStreamTimeoutSec.value = Math.round(
              (config.upstreamStreamTimeout ?? 120000) / 1000,
            )
            preflightBufferLimitMB.value =
              (config.preflightBufferLimitBytes ?? 2 * 1024 * 1024) / 1024 / 1024
            apiCatalogPoolVisibility.value = config.apiCatalogPoolVisibility ?? 'anonymous-range'
            channelTopologyMode.value = config.channelTopologyMode ?? 'legacy'
            monitorConfigEnabled.value = Boolean(config.monitorNameMapping)
            showOnlyConfigured.value = config.monitorNameMapping
              ? (config.showOnlyConfigured ?? false)
              : false
            monitorConfigs.value = Object.entries(config.monitorNameMapping ?? {}).map(
              ([id, name]) => ({ monitorId: id, displayName: name }),
            )
            modelRates.value = (config.modelRates || []).map((row) => ({
              model: (row.model || '').trim(),
              modelId: resolveModelId(row),
              pricingType: row.pricingType || 'token-based',
              inputPrice: row.inputPrice,
              outputPrice: row.outputPrice,
              fixedPrice: row.fixedPrice,
              cacheCreationMultiplier: row.cacheCreationMultiplier ?? 1.25,
              cacheReadMultiplier: row.cacheReadMultiplier ?? 0.1,
              supportedFormats: normalizeSupportedFormats(row.supportedFormats),
            }))
            relaySnapshot = clone(currentRelay())
            relayConfigurationLoaded.value = true
          } catch (error) {
            showError(error, i18ns.t('ServerConfigView.loadFailed'))
          }
        })(),
        (async () => {
          try {
            const config = await configService.getRelayConfig()
            relayUpstreamUrl.value = config.upstreamUrl || ''
            relayUpstreamApiKey.value = config.upstreamApiKey || ''
            relayAllowedModels.value = config.allowedModels || ''
            relayCustomKeyEnabled.value = config.customKeyEnabled
            relayCustomKeyMaxTokensPerUser.value = config.customKeyMaxTokensPerUser
            relayCustomKeyCreateLimitWindowMinutes.value = config.customKeyCreateLimitWindowMinutes
            relayCustomKeyCreateLimitMaxCount.value = config.customKeyCreateLimitMaxCount
            systemSnapshot = clone(currentSystem())
            systemRelayConfigurationLoaded.value = true
          } catch (error) {
            showError(error, i18ns.t('ServerConfigView.loadFailed'))
          }
        })(),
      ])
    } finally {
      loading.value = false
    }
  }

  const save = async () => {
    if (saving.value || loading.value) return
    saving.value = true
    try {
      const current = relaySnapshot ? clone(currentRelay()) : null
      // Only touched fields are sent; modelRates is a checked whole-list replacement.
      const patch =
        current && relaySnapshot
          ? (Object.fromEntries(
              Object.entries(current).filter(
                ([key, value]) => !equal(value, relaySnapshot![key as keyof RelayPayload]),
              ),
            ) as RelayPayload)
          : null
      if (patch?.modelRates) {
        const rates = patch.modelRates
        if (new Set(rates.map((row) => row.model)).size !== rates.length) {
          ElMessage.error(i18ns.t('ServerConfigView.duplicateModelName'))
          return
        }
        if (rates.some((row) => !MODEL_ID_PATTERN.test(row.modelId || row.model))) {
          ElMessage.error(i18ns.t('ServerConfigView.invalidModelId'))
          return
        }
        const nonnegative = (value: unknown) =>
          typeof value === 'number' && Number.isFinite(value) && value >= 0
        if (
          rates.some(
            (row) =>
              !nonnegative(row.inputPrice) ||
              !nonnegative(row.outputPrice) ||
              !nonnegative(row.cacheCreationMultiplier) ||
              !nonnegative(row.cacheReadMultiplier) ||
              (row.pricingType === 'per-request' && !nonnegative(row.fixedPrice)),
          )
        ) {
          ElMessage.error(i18ns.t('ServerConfigView.invalidModelPricing'))
          return
        }
      }
      const system = systemSnapshot ? clone(currentSystem()) : null
      const tasks: { scope: 'relay' | 'system'; run: () => Promise<unknown> }[] = []
      if (current && patch && Object.keys(patch).length)
        tasks.push({
          scope: 'relay',
          run: async () => {
            await relayConfigService.updateRelayConfig(patch)
            relaySnapshot = current
          },
        })
      if (system && !equal(system, systemSnapshot))
        tasks.push({
          scope: 'system',
          run: async () => {
            await configService.setRelayConfig(system)
            systemSnapshot = system
          },
        })
      if (!tasks.length) {
        ElMessage.info(i18ns.t('ServerConfigView.noConfigurationChanges'))
        return
      }
      const results = await Promise.allSettled(tasks.map((task) => task.run()))
      const failed = results.filter(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      )
      const succeeded = results.length - failed.length
      if (failed.length) {
        if (succeeded) ElMessage.warning(i18ns.t('ServerConfigView.configurationPartiallySaved'))
        failed.forEach((result) => showError(result.reason, i18ns.t('ServerConfigView.saveFailed')))
      } else {
        ElMessage.success(i18ns.t('ServerConfigView.saveSuccess'))
      }
      if (
        tasks.some(
          (task, index) => task.scope === 'relay' && results[index]?.status === 'fulfilled',
        )
      ) {
        try {
          await afterRelaySave()
        } catch (error) {
          showError(error, i18ns.t('ServerConfigView.loadFailed'))
        }
      }
    } catch (error) {
      showError(error, i18ns.t('ServerConfigView.saveFailed'))
    } finally {
      saving.value = false
    }
  }

  return {
    loading,
    saving,
    relayConfigurationLoaded,
    systemRelayConfigurationLoaded,
    modelRates,
    globalMultiplier,
    uptimeStatusUrl,
    enableQueue,
    maxConcurrency,
    queueTimeoutSec,
    upstreamStreamTimeoutSec,
    preflightBufferLimitMB,
    apiCatalogPoolVisibility,
    channelTopologyMode,
    relayCustomKeyEnabled,
    relayCustomKeyMaxTokensPerUser,
    relayCustomKeyCreateLimitWindowMinutes,
    relayCustomKeyCreateLimitMaxCount,
    relayUpstreamUrl,
    relayUpstreamApiKey,
    relayAllowedModels,
    monitorConfigEnabled,
    showOnlyConfigured,
    monitorConfigs,
    loadConfig,
    save,
  }
}
