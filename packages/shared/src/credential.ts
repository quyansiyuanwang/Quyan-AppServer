export const CREDENTIAL_PREFIXES = {
  accessKey: { canonical: 'sk-ak-', legacy: 'ak_' },
  relayToken: { canonical: 'sk-rlt-', legacy: 'rlt_' },
  productKey: { canonical: 'sk-dpk-', legacy: 'dpk_' },
  ojApiKey: { canonical: 'sk-ojqa-', legacy: 'ojqa_' },
  projectKey: { canonical: 'sk-dk-', legacy: 'dk_' },
} as const

export type CredentialType = keyof typeof CREDENTIAL_PREFIXES

export type CredentialClassification = CredentialType | 'unknown'

type CredentialPrefix = (typeof CREDENTIAL_PREFIXES)[CredentialType]

const PREFIX_ENTRIES = Object.entries(CREDENTIAL_PREFIXES) as Array<[CredentialType, CredentialPrefix]>

export function classifyCredential(value: string | null | undefined): CredentialClassification {
  if (!value) return 'unknown'
  const entry = PREFIX_ENTRIES.find(([, prefixes]) => value.startsWith(prefixes.canonical) || value.startsWith(prefixes.legacy))
  return entry?.[0] ?? 'unknown'
}

export function isCredentialOfType(value: string | null | undefined, type: CredentialType): boolean {
  if (!value) return false
  const prefixes = CREDENTIAL_PREFIXES[type]
  return value.startsWith(prefixes.canonical) || value.startsWith(prefixes.legacy)
}

/** Converts a known legacy credential prefix to its canonical prefix without changing its secret suffix. */
export function toCanonicalCredential(value: string, type?: CredentialType): string {
  const entry = type
    ? ([type, CREDENTIAL_PREFIXES[type]] as [CredentialType, CredentialPrefix])
    : PREFIX_ENTRIES.find(([, prefixes]) => value.startsWith(prefixes.legacy))
  if (!entry || !value.startsWith(entry[1].legacy)) return value
  return `${entry[1].canonical}${value.slice(entry[1].legacy.length)}`
}

/** Returns the legacy alias for a canonical credential, preserving its secret suffix. */
export function toLegacyCredential(value: string, type?: CredentialType): string {
  const entry = type
    ? ([type, CREDENTIAL_PREFIXES[type]] as [CredentialType, CredentialPrefix])
    : PREFIX_ENTRIES.find(([, prefixes]) => value.startsWith(prefixes.canonical))
  if (!entry || !value.startsWith(entry[1].canonical)) return value
  return `${entry[1].legacy}${value.slice(entry[1].canonical.length)}`
}

export function getCredentialPrefix(type: CredentialType, format: 'canonical' | 'legacy' = 'canonical'): string {
  return CREDENTIAL_PREFIXES[type][format]
}

export function isCanonicalCredential(value: string | null | undefined, type?: CredentialType): boolean {
  if (!value) return false
  if (type) return value.startsWith(CREDENTIAL_PREFIXES[type].canonical)
  return PREFIX_ENTRIES.some(([, prefixes]) => value.startsWith(prefixes.canonical))
}

export function isLegacyCredential(value: string | null | undefined, type?: CredentialType): boolean {
  if (!value) return false
  if (type) return value.startsWith(CREDENTIAL_PREFIXES[type].legacy)
  return PREFIX_ENTRIES.some(([, prefixes]) => value.startsWith(prefixes.legacy))
}

/** Validates a credential value while allowing the legacy format during migration. */
export function isValidCredential(value: string | null | undefined, type: CredentialType, minSuffixLength = 1): boolean {
  if (!value || !isCredentialOfType(value, type)) return false
  const prefix = isCanonicalCredential(value, type)
    ? CREDENTIAL_PREFIXES[type].canonical
    : CREDENTIAL_PREFIXES[type].legacy
  const suffix = value.slice(prefix.length)
  return suffix.length >= minSuffixLength && /^[A-Za-z0-9-]+$/.test(suffix)
}
