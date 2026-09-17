// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const { getLocaleMock, setLocaleMock } = vi.hoisted(() => ({
  getLocaleMock: vi.fn(() => 'zh-CN'),
  setLocaleMock: vi.fn(),
}))

vi.mock('@/locales', () => ({
  getLocale: getLocaleMock,
  setLocale: setLocaleMock,
}))
vi.mock('@/stores/globalInstance', () => ({
  i18nEventBus: { emit: vi.fn() },
}))

describe('i18n store locale changes', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    getLocaleMock.mockReturnValue('zh-CN')
  })

  it('keeps the current locale when the requested locale fails to load', async () => {
    setLocaleMock.mockRejectedValue(new Error('chunk unavailable'))
    const { useI18nStore } = await import('@/stores/i18nStore')
    const store = useI18nStore()

    await expect(store.changeLocale('en')).rejects.toThrow('chunk unavailable')
    expect(store.currentLocale).toBe('zh-CN')
  })

  it('serializes rapid locale changes and applies the latest request', async () => {
    const resolvers = new Map<string, () => void>()
    setLocaleMock.mockImplementation(
      (locale: string) =>
        new Promise<void>((resolve) => {
          resolvers.set(locale, resolve)
        }),
    )
    const { useI18nStore } = await import('@/stores/i18nStore')
    const store = useI18nStore()

    const first = store.changeLocale('en')
    const second = store.changeLocale('emoji')
    await vi.waitFor(() => expect(setLocaleMock).toHaveBeenCalledWith('en'))

    resolvers.get('en')?.()
    await vi.waitFor(() => expect(setLocaleMock).toHaveBeenCalledWith('emoji'))
    resolvers.get('emoji')?.()

    await Promise.all([first, second])
    expect(store.currentLocale).toBe('emoji')
  })
})
