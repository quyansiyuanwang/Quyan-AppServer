import type { ProbeKeyValueEntry } from '../components/ProbeKeyValueEditor.vue'
import { createUserFacingError } from '@/utils/error-utils'
import { i18ns } from '@/locales'

export function makeKeyValueEntries(
  value: Record<string, unknown> | undefined,
  body = false,
): ProbeKeyValueEntry[] {
  return Object.entries(value ?? {}).map(([key, item]) => {
    const valueType =
      body && typeof item === 'number'
        ? 'number'
        : body && typeof item === 'boolean'
          ? 'boolean'
          : body && (item === null || typeof item === 'object')
            ? 'json'
            : 'text'
    return {
      id: crypto.randomUUID(),
      key,
      value: valueType === 'json' ? JSON.stringify(item) : String(item ?? ''),
      valueType,
    }
  })
}
export function ensureUniqueFieldKey(key: string, target: Record<string, unknown>, label: string) {
  if (
    !key.trim() ||
    Object.prototype.hasOwnProperty.call(target, key.trim()) ||
    ['__proto__', 'constructor', 'prototype'].includes(key.trim())
  )
    throw createUserFacingError(i18ns.t('relay.channelProbeInvalidField', { label }))
}
export function textFields(entries: ProbeKeyValueEntry[], label: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const entry of entries) {
    if (!entry.key.trim() && !entry.value.trim()) continue
    ensureUniqueFieldKey(entry.key, result, label)
    result[entry.key.trim()] = entry.value
  }
  return result
}
export function bodyFields(entries: ProbeKeyValueEntry[]): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const entry of entries) {
    if (!entry.key.trim() && !entry.value.trim()) continue
    ensureUniqueFieldKey(entry.key, result, i18ns.t('relay.channelProbeBody'))
    const value = entry.value.trim()
    if (entry.valueType === 'text') result[entry.key.trim()] = entry.value
    else if (entry.valueType === 'number') {
      const number = Number(value)
      if (!value || !Number.isFinite(number))
        throw createUserFacingError(i18ns.t('relay.channelProbeInvalidField', { label: entry.key }))
      result[entry.key.trim()] = number
    } else if (entry.valueType === 'boolean') {
      if (value !== 'true' && value !== 'false')
        throw createUserFacingError(i18ns.t('relay.channelProbeInvalidField', { label: entry.key }))
      result[entry.key.trim()] = value === 'true'
    } else {
      try {
        result[entry.key.trim()] = JSON.parse(value)
      } catch {
        throw createUserFacingError(i18ns.t('relay.channelProbeInvalidJson'))
      }
    }
  }
  return result
}

export function remainingRetainedFields(value: unknown, paths: string[][]): string[][] {
  return paths.filter((path) => {
    let current = value
    for (const key of path) {
      if (
        !current ||
        typeof current !== 'object' ||
        !Object.prototype.hasOwnProperty.call(current, key)
      )
        return false
      current = (current as Record<string, unknown>)[key]
    }
    return current === ''
  })
}
