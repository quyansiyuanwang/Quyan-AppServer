import { TypedBrowserStorage } from './typedLocalStorage'

/** Type-safe, SSR-safe wrapper for short-lived browser session storage. */
export const TypedSessionStorage = new TypedBrowserStorage('session')
