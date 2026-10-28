// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useRelayGlobalConfiguration } from '@/views/relay/relay-settings/useRelayGlobalConfiguration'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
  getSystem: vi.fn(),
  setSystem: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  notice: vi.fn(),
}))
vi.mock('@/service/relayConfigService', () => ({
  relayConfigService: { getRelayConfig: mocks.get, updateRelayConfig: mocks.update },
}))
vi.mock('@/service/configService', () => ({
  configService: { getRelayConfig: mocks.getSystem, setRelayConfig: mocks.setSystem },
}))
vi.mock('@/utils/elementPlusRuntime', () => ({
  ElMessage: {
    success: mocks.success,
    warning: mocks.warning,
    info: mocks.info,
    error: mocks.error,
  },
}))
vi.mock('@/utils/requestErrorNotice', () => ({ showRequestErrorNotice: mocks.notice }))
vi.mock('@/service/twoFactorNavigationService', () => ({
  isTwoFactorRequiredResponse: (error: unknown) => error === 'fixture-stepup',
}))
vi.mock('@/locales', () => ({ i18ns: { t: (key: string) => key } }))
const config = () => ({
  globalMultiplier: 1,
  uptimeStatusUrl: '',
  enableQueue: true,
  maxConcurrency: 5,
  queueTimeout: 30000,
  upstreamStreamTimeout: 120000,
  preflightBufferLimitBytes: 2097152,
  apiCatalogPoolVisibility: 'anonymous-range',
  channelTopologyMode: 'strict-two-tier',
  monitorNameMapping: null,
  showOnlyConfigured: false,
  modelRates: [
    {
      model: 'fixture-model',
      modelId: 'fixture/model',
      pricingType: 'token-based',
      inputPrice: 1,
      outputPrice: 2,
      cacheCreationMultiplier: 1.25,
      cacheReadMultiplier: 0.1,
      supportedFormats: 'openai-chat-completions',
    },
  ],
})
const system = () => ({
  upstreamUrl: '',
  upstreamApiKey: '',
  allowedModels: '',
  customKeyEnabled: true,
  customKeyMaxTokensPerUser: 3,
  customKeyCreateLimitWindowMinutes: 10,
  customKeyCreateLimitMaxCount: 5,
})
const loaded = async () => {
  const refresh = vi.fn().mockResolvedValue(undefined),
    api = useRelayGlobalConfiguration(refresh)
  await api.loadConfig()
  return { api, refresh }
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.get.mockResolvedValue(config())
  mocks.getSystem.mockResolvedValue(system())
  mocks.update.mockResolvedValue({ ...config(), modelRates: [] })
  mocks.setSystem.mockResolvedValue(undefined)
})
describe('independent relay configuration editing', () => {
  it('does not save unchanged forms or replace a filtered pricing list', async () => {
    const { api } = await loaded()
    await api.save()
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.setSystem).not.toHaveBeenCalled()
    expect(mocks.info).toHaveBeenCalledWith('ServerConfigView.noConfigurationChanges')
  })
  it('submits only changed relay fields and omits modelRates', async () => {
    const { api, refresh } = await loaded()
    api.maxConcurrency.value = 8
    await api.save()
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({ maxConcurrency: 8 })
    expect(mocks.setSystem).not.toHaveBeenCalled()
    expect(refresh).toHaveBeenCalledOnce()
    await api.save()
    expect(mocks.update).toHaveBeenCalledTimes(1)
  })
  it('keeps relay configuration usable when system configuration is denied', async () => {
    const denied = { response: { status: 403 } }
    mocks.getSystem.mockRejectedValue(denied)
    const { api } = await loaded()
    expect(api.relayConfigurationLoaded.value).toBe(true)
    expect(api.systemRelayConfigurationLoaded.value).toBe(false)
    api.maxConcurrency.value = 8
    api.relayCustomKeyEnabled.value = false
    await api.save()
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({ maxConcurrency: 8 })
    expect(mocks.setSystem).not.toHaveBeenCalled()
    expect(mocks.notice).toHaveBeenCalledWith(denied, 'ServerConfigView.loadFailed')
  })
  it('keeps system settings usable when relay configuration is denied', async () => {
    mocks.get.mockRejectedValue({ response: { status: 403 } })
    const { api } = await loaded()
    expect(api.relayConfigurationLoaded.value).toBe(false)
    expect(api.systemRelayConfigurationLoaded.value).toBe(true)
    api.maxConcurrency.value = 8
    api.relayCustomKeyEnabled.value = false
    await api.save()
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.setSystem).toHaveBeenCalledExactlyOnceWith({
      ...system(),
      customKeyEnabled: false,
    })
  })
  it('invalidates previously loaded snapshots when a reload is denied', async () => {
    const { api } = await loaded()
    mocks.get.mockRejectedValue(new Error('fixture denied'))
    mocks.getSystem.mockRejectedValue(new Error('fixture denied'))
    await api.loadConfig()
    api.maxConcurrency.value = 8
    api.relayCustomKeyEnabled.value = false
    await api.save()
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.setSystem).not.toHaveBeenCalled()
  })
  it.each(['token-based', 'per-request'] as const)(
    'preserves valid zero-cost %s prices',
    async (pricingType) => {
      const { api } = await loaded()
      Object.assign(api.modelRates.value[0]!, {
        pricingType,
        inputPrice: 0,
        outputPrice: 0,
        fixedPrice: 0,
      })
      await api.save()
      expect(mocks.update).toHaveBeenCalledExactlyOnceWith({
        modelRates: [
          expect.objectContaining({ pricingType, inputPrice: 0, outputPrice: 0, fixedPrice: 0 }),
        ],
      })
    },
  )
  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid named rows instead of silently deleting them: %s',
    async (inputPrice) => {
      const { api } = await loaded()
      api.modelRates.value[0]!.inputPrice = inputPrice
      await api.save()
      expect(mocks.update).not.toHaveBeenCalled()
      expect(mocks.error).toHaveBeenCalledWith('ServerConfigView.invalidModelPricing')
    },
  )
  it('rejects duplicates after trimming and malformed model identities', async () => {
    const { api } = await loaded()
    api.modelRates.value.push({ ...api.modelRates.value[0]!, model: ' fixture-model ' })
    await api.save()
    expect(mocks.error).toHaveBeenCalledWith('ServerConfigView.duplicateModelName')
    api.modelRates.value.pop()
    api.modelRates.value[0]!.modelId = 'invalid model id'
    await api.save()
    expect(mocks.error).toHaveBeenCalledWith('ServerConfigView.invalidModelId')
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it('sends an intentional empty replacement and can explicitly clear the monitoring URL', async () => {
    mocks.get.mockResolvedValue({ ...config(), uptimeStatusUrl: 'https://example.invalid/status' })
    const { api } = await loaded()
    api.modelRates.value = []
    api.uptimeStatusUrl.value = ''
    await api.save()
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({ modelRates: [], uptimeStatusUrl: '' })
  })
  it('preserves edited prices in the form when a write-only response contains no prices', async () => {
    const { api } = await loaded()
    api.modelRates.value[0]!.inputPrice = 7
    await api.save()
    expect(api.modelRates.value[0]!.inputPrice).toBe(7)
    await api.save()
    expect(mocks.update).toHaveBeenCalledOnce()
  })
  it.each(['relay', 'system'])(
    'reports partial success and retries only the failed %s operation',
    async (failed) => {
      const { api } = await loaded()
      const failing = failed === 'relay' ? mocks.update : mocks.setSystem
      failing.mockRejectedValueOnce(new Error('fixture failure'))
      api.maxConcurrency.value = 8
      api.relayCustomKeyEnabled.value = false
      await api.save()
      expect(mocks.success).not.toHaveBeenCalled()
      expect(mocks.warning).toHaveBeenCalledWith('ServerConfigView.configurationPartiallySaved')
      await api.save()
      expect(failing).toHaveBeenCalledTimes(2)
      expect(failed === 'relay' ? mocks.setSystem : mocks.update).toHaveBeenCalledTimes(1)
      expect(mocks.success).toHaveBeenCalledOnce()
    },
  )
  it('awaits both failures, does not report success, and preserves both changes for retry', async () => {
    const { api } = await loaded()
    mocks.update.mockRejectedValueOnce(new Error('relay failed'))
    mocks.setSystem.mockRejectedValueOnce(new Error('system failed'))
    api.maxConcurrency.value = 8
    api.relayCustomKeyEnabled.value = false
    await api.save()
    expect(mocks.notice).toHaveBeenCalledTimes(2)
    expect(mocks.success).not.toHaveBeenCalled()
    expect(mocks.warning).not.toHaveBeenCalled()
    await api.save()
    expect(mocks.update).toHaveBeenCalledTimes(2)
    expect(mocks.setSystem).toHaveBeenCalledTimes(2)
  })
  it('does not replace a step-up challenge with an ordinary operation error', async () => {
    const { api } = await loaded()
    mocks.update.mockRejectedValueOnce('fixture-stepup')
    api.maxConcurrency.value = 8
    await api.save()
    expect(mocks.notice).not.toHaveBeenCalled()
    expect(mocks.success).not.toHaveBeenCalled()
  })
  it('admits a save once while a request is pending and snapshots the submitted values', async () => {
    const { api } = await loaded()
    let finish!: () => void
    mocks.update.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    api.maxConcurrency.value = 8
    const pending = api.save()
    api.maxConcurrency.value = 9
    await api.save()
    finish()
    await pending
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({ maxConcurrency: 8 })
    await api.save()
    expect(mocks.update).toHaveBeenLastCalledWith({ maxConcurrency: 9 })
  })
})
