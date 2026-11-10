import { matchesModelPattern } from '@quyan/shared'
import type { RelayCatalogModelMappingDto, RelayCatalogOptionDto } from '@/client/types.gen'
import { normalizeRelayFormatArray, normalizeRelayFormats } from './relay-formats'

export function getCatalogModelMappings(
  channel: RelayCatalogOptionDto,
  item: { model?: string | null; supportedFormats?: string | null },
  format?: string,
): RelayCatalogModelMappingDto[] {
  const formats = normalizeRelayFormats(item.supportedFormats)
  const selectedFormats = format ? normalizeRelayFormats(format) : formats
  return (channel.modelMappings ?? []).flatMap((mapping) => {
    if (mapping.catalogModelName !== item.model?.trim()) return []
    const supportedRequestFormats = normalizeRelayFormatArray(
      mapping.supportedRequestFormats,
    ).filter((entry) => formats.includes(entry) && selectedFormats.includes(entry))
    return supportedRequestFormats.length ? [{ ...mapping, supportedRequestFormats }] : []
  })
}

export function catalogMappingMatchesKeyword(
  mapping: RelayCatalogModelMappingDto,
  keyword: string,
): boolean {
  const query = keyword.trim()
  if (!query) return true
  // Glob matching remains case sensitive, just like billing. Text search is case insensitive.
  const matches =
    mapping.requestModelPattern.toLowerCase().includes(query.toLowerCase()) ||
    matchesModelPattern(query, mapping.requestModelPattern)
  return (
    matches &&
    !(mapping.excludedRequestModelPatterns ?? []).some((pattern) =>
      matchesModelPattern(query, pattern),
    )
  )
}
