import { EventBus } from '@/utils/EventBus'
import {
  type AUTH_EVENTS,
  type I18N_EVENTS,
  type WINDOW_EVENTS,
  type GLOBAL_EVENTS,
  type APRIL_FOOLS_EVENTS,
} from '@/constant/events'
import type { AxiosResponse, AxiosError, HttpStatusCode } from 'axios'
import type { CustomCode } from '@/constant/custom-code'

export const webEventBus = new EventBus<
  keyof typeof HttpStatusCode,
  (arg0: AxiosResponse | AxiosError) => any
>()
export const authEventBus = new EventBus<AUTH_EVENTS, (arg0: any) => any>()
export const i18nEventBus = new EventBus<I18N_EVENTS, (newLocale: string) => void>()
export const windowEventBus = new EventBus<WINDOW_EVENTS, (isDesktop: boolean) => void>()
export const globalEventBus = new EventBus<GLOBAL_EVENTS, (arg0: any) => any>()
export const customCodeBus = new EventBus<
  keyof typeof CustomCode,
  (data: { code: number; data?: { expireTime: string; reason: string } }) => any
>()
export const aprilFoolsEventBus = new EventBus<APRIL_FOOLS_EVENTS, (arg0?: any) => any>()
