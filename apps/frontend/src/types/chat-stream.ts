import type { ChatStreamEvent } from '@appserver/shared'
import type { MessageResponse } from '@/client/types.gen'

export type ChatStreamClientEvent =
  | { type: 'delta'; content: string }
  | { type: 'complete'; message: MessageResponse }
  | {
      type: 'failure'
      kind: 'aborted' | 'network' | 'http' | 'protocol' | 'server'
      message: string
    }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const parseChatStreamEvent = (data: string): ChatStreamEvent => {
  const parsed: unknown = JSON.parse(data)
  if (!isRecord(parsed) || typeof parsed.type !== 'string' || typeof parsed.done !== 'boolean')
    throw new Error('Invalid chat stream event')
  if (parsed.type === 'delta' && parsed.done === false && typeof parsed.content === 'string')
    return parsed as ChatStreamEvent
  if (parsed.type === 'error' && parsed.done === true && typeof parsed.error === 'string')
    return parsed as ChatStreamEvent
  if (parsed.type === 'done' && parsed.done === true) return parsed as ChatStreamEvent
  if (
    parsed.type === 'complete' &&
    parsed.done === true &&
    isRecord(parsed.message) &&
    typeof parsed.message.id === 'string' &&
    typeof parsed.message.conversationId === 'string' &&
    typeof parsed.message.content === 'string'
  )
    return parsed as ChatStreamEvent
  throw new Error('Invalid chat stream event')
}
