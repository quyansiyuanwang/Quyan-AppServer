import { EventBus } from '@/utils/EventBus'
import { type I18N_EVENTS, type WINDOW_EVENTS, type APRIL_FOOLS_EVENTS } from '@/constant/events'

export const i18nEventBus = new EventBus<I18N_EVENTS, (newLocale: string) => void>()
export const windowEventBus = new EventBus<WINDOW_EVENTS, (isDesktop: boolean) => void>()
export const aprilFoolsEventBus = new EventBus<APRIL_FOOLS_EVENTS, (arg0?: any) => any>()
