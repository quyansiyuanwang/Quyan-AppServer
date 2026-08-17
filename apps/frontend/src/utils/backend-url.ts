/**
 * Resolve an API path against the backend origin used by the axios request
 * client. Release builds pin `VITE_BACKEND_URL` to the public API origin (for
 * example `https://api.qysyw.cn`); when it is blank (local development),
 * requests stay same-origin and the Vite dev-server proxy forwards `/v1/*` to
 * the backend.
 */
export const buildBackendUrl = (
  path: string,
  baseUrl: string = import.meta.env.VITE_BACKEND_URL ?? '',
): string => {
  if (/^https?:\/\//.test(path)) return path
  const normalizedBase = baseUrl.trim()
  if (!normalizedBase) return path
  const base = normalizedBase.endsWith('/') ? normalizedBase.slice(0, -1) : normalizedBase
  const suffix = path.startsWith('/') ? path : `/${path}`
  return `${base}${suffix}`
}
