// Shared, side-effect-free configuration for the privilege-free localhost mode.
// It lives in its own module so importing the constants never starts a process.

export const LOCAL_DEV_ORIGIN = 'http://localhost:5173'

/**
 * Process-level environment for the backend child process of `pnpm run dev`.
 *
 * - CORS must accept the plain-HTTP SPA origin, because the Vite proxy forwards
 *   the browser Origin to the backend.
 * - Session cookies must be host-scoped: a `.qysyw.test` Domain attribute is
 *   rejected by the browser on a localhost origin, which would silently break
 *   login and refresh in this mode.
 * - FRONTEND_BASE_URL keeps social-auth redirects on the same origin.
 */
export const localBackendOverrides = {
  CORS_ALLOWED_ORIGINS: LOCAL_DEV_ORIGIN,
  FRONTEND_BASE_URL: LOCAL_DEV_ORIGIN,
  AUTH_REFRESH_COOKIE_DOMAIN: '',
  AUTH_SESSION_COOKIE_DOMAIN: '',
  TWO_FACTOR_TRUSTED_DEVICE_COOKIE_DOMAIN: '',
}
