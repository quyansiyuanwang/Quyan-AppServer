import type { RelayRequestFormat } from './relay-model-availability'

/** Built-in forwarding policy, shared by the proxy and the channel editor's default table. */
export const RELAY_DEFAULT_FORWARDED_HEADERS = {
  common: [
    'content-type',
    'accept',
    'accept-encoding',
    'user-agent',
    'x-request-id',
    'x-client-request-id',
    'idempotency-key',
    'x-opencode-session',
  ],
  openai: ['openai-organization', 'openai-project', 'openai-beta'],
  anthropic: ['anthropic-version', 'anthropic-beta'],
  gemini: ['x-goog-api-client'],
} as const

export function getRelayDefaultForwardedHeaderNames(format: RelayRequestFormat): readonly string[] {
  const protocol = format === 'anthropic' || format === 'gemini' ? format : 'openai'
  return [...RELAY_DEFAULT_FORWARDED_HEADERS.common, ...RELAY_DEFAULT_FORWARDED_HEADERS[protocol]]
}

/** Limits and reserved names for administrator-configured request-header forwarding. */
export const RELAY_FORWARDED_HEADER_LIMITS = { maxNames: 64, maxNameLength: 128 } as const

const RESERVED_NAMES = new Set([
  'authorization',
  'proxy-authorization',
  'proxy-authenticate',
  'www-authenticate',
  'x-api-key',
  'x-goog-api-key',
  'api-key',
  'apikey',
  'cookie',
  'set-cookie',
  'host',
  'content-length',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'te',
  'trailer',
  'upgrade',
  'http2-settings',
  'expect',
  'forwarded',
  'via',
  'x-real-ip',
  'x-original-url',
  'x-rewrite-url',
  '__proto__',
  'constructor',
  'prototype',
  'x-access-key',
  'x-access-token',
  'x-auth-token',
  'x-client-fingerprint',
  'x-nonce',
  'x-timestamp',
  'x-sign',
  'x-captcha-token',
])
const RESERVED_PREFIXES = [
  'x-forwarded-',
  'x-quyan-',
  'x-relay-',
  'x-internal-',
  'x-replay-',
  'x-two-factor-',
  'sec-',
  'proxy-',
]

/** Exact names only; no wildcards, credentials, routing metadata or hop-by-hop fields. */
export function isRelayForwardableHeaderName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= RELAY_FORWARDED_HEADER_LIMITS.maxNameLength &&
    /^[a-z0-9!#$%&'+.^_`|~-]+$/.test(name) &&
    !RESERVED_NAMES.has(name) &&
    !RESERVED_PREFIXES.some((prefix) => name.startsWith(prefix))
  )
}

/** Undefined means invalid configuration; [] explicitly clears extra forwarding. */
export function normalizeRelayForwardedHeaderNames(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length > RELAY_FORWARDED_HEADER_LIMITS.maxNames)
    return undefined
  const names: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string') return undefined
    const name = entry.trim().toLowerCase()
    if (!isRelayForwardableHeaderName(name)) return undefined
    if (!names.includes(name)) names.push(name)
  }
  return names
}
