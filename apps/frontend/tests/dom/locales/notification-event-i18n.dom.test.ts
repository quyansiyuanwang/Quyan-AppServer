// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed } from 'vue'
import {
  ALL_NOTIFICATION_EVENTS,
  THRESHOLD_NOTIFICATION_EVENTS,
  NOTIFICATION_EVENT_I18N_KEYS,
} from '@quyan/shared'
import en from '@/locales/sites/shared/en'
import zhCN from '@/locales/sites/shared/zh-CN'
import emoji from '@/locales/sites/shared/emoji'

const messages = { en, 'zh-CN': zhCN, emoji }

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
  document.cookie = 'appserver.preference.locale=zh-CN; Path=/'
})

describe('notification labels from the shared event catalog', () => {
  it.each(
    (['zh-CN', 'en', 'emoji'] as const).flatMap((locale) => [
      { locale, site: 'account' as const, route: 'notificationSettings' },
      { locale, site: 'management-core' as const, route: 'serverConfig' },
    ]),
  )(
    'loads every event and threshold label on a direct $route visit in $locale',
    async ({ locale, site, route }) => {
      document.cookie = 'appserver.preference.locale=' + locale + '; Path=/'
      const { initializeI18n, ensureRouteLocaleMessages, i18n } = await import('@/locales')
      await initializeI18n(5000, site)
      expect(i18n.global.te(NOTIFICATION_EVENT_I18N_KEYS.balance_low, locale)).toBe(false)
      await ensureRouteLocaleMessages(locale, site, [route])
      const { getNotificationEventLabel, getNotificationThresholdUnit } = await import(
        '@/utils/notification-event-i18n'
      )

      for (const event of ALL_NOTIFICATION_EVENTS) {
        expect(getNotificationEventLabel(event), event).toBe(
          messages[locale].notificationEvent[event],
        )
        expect(getNotificationEventLabel(event)).not.toBe(NOTIFICATION_EVENT_I18N_KEYS[event])
      }
      for (const event of THRESHOLD_NOTIFICATION_EVENTS)
        expect(getNotificationThresholdUnit(event), event).toBe(
          messages[locale].notificationEventThresholdUnit[event],
        )
      expect(getNotificationEventLabel('future_unknown_event')).toBe('future_unknown_event')
      expect(getNotificationThresholdUnit('future_unknown_event')).toBe('')
    },
  )

  it('updates shared event labels and units when the user changes language', async () => {
    const { initializeI18n, ensureRouteLocaleMessages, setLocale } = await import('@/locales')
    await initializeI18n(5000, 'account')
    await ensureRouteLocaleMessages('zh-CN', 'account', ['notificationSettings'])
    const { getNotificationEventLabel, getNotificationThresholdUnit } = await import(
      '@/utils/notification-event-i18n'
    )
    const label = computed(() => getNotificationEventLabel('relay_probe_round_completed'))
    const unit = computed(() => getNotificationThresholdUnit('monthly_pass_quota_low'))
    expect(label.value).toBe(zhCN.notificationEvent.relay_probe_round_completed)
    expect(unit.value).toBe(zhCN.notificationEventThresholdUnit.monthly_pass_quota_low)
    await setLocale('en')
    expect(label.value).toBe(en.notificationEvent.relay_probe_round_completed)
    expect(unit.value).toBe(en.notificationEventThresholdUnit.monthly_pass_quota_low)
  })
})
