import { describe, expect, it } from 'vitest'
import {
  catalogMappingMatchesKeyword,
  getCatalogModelMappings,
} from '@/utils/relay-catalog-mappings'
import type { RelayCatalogModelMappingDto, RelayCatalogOptionDto } from '@/client/types.gen'

const mapping = (
  overrides: Partial<RelayCatalogModelMappingDto> = {},
): RelayCatalogModelMappingDto => ({
  requestModelPattern: 'client-*',
  catalogModelName: 'Billing model',
  billingModelId: 'billing-model',
  supportedRequestFormats: ['openai-chat-completions', 'anthropic'],
  ...overrides,
})

describe('catalog model mapping discovery', () => {
  it('matches source substrings and concrete glob requests while preserving runtime glob case sensitivity', () => {
    expect(catalogMappingMatchesKeyword(mapping(), 'CLIENT-')).toBe(true)
    expect(catalogMappingMatchesKeyword(mapping(), 'client-example')).toBe(true)
    expect(catalogMappingMatchesKeyword(mapping(), 'CLIENT-example')).toBe(false)
    expect(
      catalogMappingMatchesKeyword(mapping({ requestModelPattern: 'client-?' }), 'client-x'),
    ).toBe(true)
    expect(
      catalogMappingMatchesKeyword(mapping({ requestModelPattern: 'client-?' }), 'client-xx'),
    ).toBe(false)
  })

  it('honors exact, specific and insertion-order exclusions even without a published target', () => {
    const rule = mapping({ excludedRequestModelPatterns: ['client-pro-*', 'client-blocked'] })
    expect(catalogMappingMatchesKeyword(rule, 'client-pro-x')).toBe(false)
    expect(catalogMappingMatchesKeyword(rule, 'client-blocked')).toBe(false)
    expect(catalogMappingMatchesKeyword(rule, 'client-basic')).toBe(true)
    const tie = mapping({ requestModelPattern: '*-x', excludedRequestModelPatterns: ['a-*'] })
    expect(catalogMappingMatchesKeyword(tie, 'a-x')).toBe(false)
    expect(catalogMappingMatchesKeyword(tie, 'b-x')).toBe(true)
  })

  it('returns only the pricing model and common formats without altering the catalog', () => {
    const mappings = [mapping(), mapping({ catalogModelName: 'Other model' })]
    const channel = { modelMappings: mappings } as RelayCatalogOptionDto
    const result = getCatalogModelMappings(channel, {
      model: 'Billing model',
      supportedFormats: 'openai',
    })
    expect(result).toEqual([mapping({ supportedRequestFormats: ['openai-chat-completions'] })])
    expect(mappings[0]!.supportedRequestFormats).toEqual(['openai-chat-completions', 'anthropic'])
    expect(
      getCatalogModelMappings(
        channel,
        { model: 'Billing model', supportedFormats: 'openai' },
        'anthropic',
      ),
    ).toEqual([])
    expect(
      getCatalogModelMappings({} as RelayCatalogOptionDto, { model: 'Billing model' }),
    ).toEqual([])
  })
})
