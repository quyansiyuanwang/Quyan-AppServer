import { describe, expect, it } from 'vitest'
import en from '@/locales/en'
import zhCN from '@/locales/zh-CN'
import emoji from '@/locales/emoji'
import baseEn from '@/locales/base/en'
import baseZhCN from '@/locales/base/zh-CN'
import baseEmoji from '@/locales/base/emoji'
import managementCoreEn from '@/locales/sites/management-core/en'
import managementCoreZhCN from '@/locales/sites/management-core/zh-CN'
import managementCoreEmoji from '@/locales/sites/management-core/emoji'

type MessageTree = Record<string, unknown>

const flattenKeys = (value: unknown, prefix = ''): string[] => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [prefix]
  return Object.entries(value as MessageTree).flatMap(([key, child]) =>
    flattenKeys(child, prefix ? `${prefix}.${key}` : key),
  )
}

const sortedKeys = (value: unknown) => flattenKeys(value).sort()

describe('locale bundle schema', () => {
  it('keeps the merged locale trees in exact key parity', () => {
    expect(sortedKeys(zhCN)).toEqual(sortedKeys(en))
    expect(sortedKeys(emoji)).toEqual(sortedKeys(en))
  })

  it('keeps base and management-core bundles in exact key parity', () => {
    expect(sortedKeys(baseZhCN)).toEqual(sortedKeys(baseEn))
    expect(sortedKeys(baseEmoji)).toEqual(sortedKeys(baseEn))
    expect(sortedKeys(managementCoreZhCN)).toEqual(sortedKeys(managementCoreEn))
    expect(sortedKeys(managementCoreEmoji)).toEqual(sortedKeys(managementCoreEn))
  })

  it('keeps the permission category catalog independent across namespaces', () => {
    const labels = en.RamManagement.permissionCategoryLabels
    expect(labels.agent).not.toBe(labels.user)
    expect(labels.carpool).not.toBe(labels.user)
    expect(labels.developer).not.toBe(labels.user)
    expect(labels.mcp).not.toBe(labels.user)
    expect(labels.support).not.toBe(labels.user)
    expect(labels.unknown).toBe('Other Permission Area')
  })
})
