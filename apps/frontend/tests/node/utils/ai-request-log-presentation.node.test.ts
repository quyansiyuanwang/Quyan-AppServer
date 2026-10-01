import { describe, expect, it, vi } from 'vitest'
vi.mock('@/locales', () => ({ i18ns: { t: (key: string) => key } }))
import {
  identityLabel,
  tokenLabel,
  formatBytes,
  outcomeLabel,
} from '@/views/relay/ai-request-logs/logPresentation'
import type { AiRequestLogListItemDto } from '@/client/types.gen'
describe('AI log safe presentation', () => {
  it('uses recorded names then safe IDs, never client-provided identity or token secrets', () => {
    const row = {
      username: null,
      userId: 'user-1',
      relayTokenName: null,
      relayTokenId: 'token-id',
    } as AiRequestLogListItemDto
    expect(identityLabel(row)).toBe('user-1')
    expect(tokenLabel(row)).toContain('token-id')
    expect(identityLabel({ ...row, userId: null })).toBe('aiRequestLogs.unrecorded')
  })
  it('keeps legacy unknown outcomes separate from HTTP success and formats byte sizes', () => {
    expect(outcomeLabel(null)).toBe('aiRequestLogs.unrecorded')
    expect(outcomeLabel('interrupted')).toBe('aiRequestLogs.interrupted')
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(null)).toBe('aiRequestLogs.unrecorded')
  })
})
