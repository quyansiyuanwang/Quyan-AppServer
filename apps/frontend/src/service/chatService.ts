import { TypedLocalStorage } from '@/utils/typedLocalStorage'
import { useRequestStore } from '@/stores/request'
import { isTokenExpired } from '@/stores/request'
import StorageKey from '@/constant/storagekey'
import { authorizationService } from '@/service/authorizationService'
import type { ChatTokenResponse, ConversationResponse, MessageResponse } from '@/client/types.gen'
import { cacheObject } from '@/utils/common'
import { createChatControllerApi } from '@/client/services/chat-controller.gen'
import type { ChatStreamEvent } from '@appserver/shared'
import type { ChatStreamClientEvent } from '@/types/chat-stream'
import { parseChatStreamEvent } from '@/types/chat-stream'
import {
  createSseClient,
  SseStreamError,
  type SseRequestMiddleware,
} from '@/utils/streaming/sseStream'

const chatApi = cacheObject(() => createChatControllerApi(useRequestStore().getAxios()))

interface ChatStreamRequestContext {
  path: string
  body: unknown
}

const appServerStreamingMiddleware: SseRequestMiddleware<ChatStreamRequestContext> = async (
  request,
  context,
) => {
  if (!context) throw new Error('Missing chat streaming request context')

  const prepared = await useRequestStore().prepareStreamingRequest(context.path, context.body)
  const headers = new Headers(request.init.headers)
  for (const [name, value] of Object.entries(prepared.headers)) headers.set(name, value)

  const token = TypedLocalStorage.getItem(StorageKey.Auth.ACCESS_TOKEN)
  if (token) headers.set('Authorization', `Bearer ${token}`)

  return { url: prepared.url, init: { ...request.init, headers } }
}

const appServerSseClient = createSseClient([appServerStreamingMiddleware])

class ChatService {
  private static instance: ChatService

  static getInstance(): ChatService {
    if (!this.instance) this.instance = new ChatService()
    return this.instance
  }

  // Compatible with both payload shapes:
  // 1) { code, message, data: BusinessData }
  // 2) { code, message, data: { code, message, data: BusinessData } }
  private unwrapResponseData<T>(response: unknown): T | undefined {
    if (!response || typeof response !== 'object') return undefined
    const level1 = (response as { data?: unknown }).data
    if (level1 === undefined) return response as T
    if (level1 && typeof level1 === 'object' && 'data' in (level1 as object)) {
      return (level1 as { data?: T }).data
    }
    return level1 as T
  }

  async getConversations(
    page = 1,
    pageSize = 20,
  ): Promise<{ total: number; conversations: ConversationResponse[] }> {
    const response = await chatApi.getConversations({
      params: { page, pageSize },
    })
    const payload = this.unwrapResponseData<{
      total: number
      conversations: ConversationResponse[]
    }>(response)

    return {
      total: payload?.total ?? 0,
      conversations: payload?.conversations ?? [],
    }
  }

  async createConversation(
    title?: string,
    relayTokenId?: string,
  ): Promise<ConversationResponse | null> {
    const response = await chatApi.createConversation({
      body: { title, relayTokenId },
    })
    return this.unwrapResponseData<ConversationResponse>(response) ?? null
  }

  async updateConversation(id: string, title?: string): Promise<ConversationResponse | null> {
    const response = await chatApi.updateConversation({
      path: { conversationId: id },
      body: { title },
    })
    return this.unwrapResponseData<ConversationResponse>(response) ?? null
  }

  async deleteConversation(id: string) {
    await chatApi.deleteConversation({ path: { conversationId: id } })
  }

  async deleteMessage(id: string) {
    await chatApi.deleteMessage({ path: { messageId: id } })
  }

  async getMessages(conversationId: string): Promise<MessageResponse[]> {
    const response = await chatApi.getMessages({ path: { conversationId } })
    return this.unwrapResponseData<MessageResponse[]>(response) ?? []
  }

  async *sendMessageStream(
    conversationId: string,
    content: string,
    model: string,
    tokenId: string | undefined,
    options: { signal?: AbortSignal; replaceMessageId?: string } = {},
  ): AsyncGenerator<ChatStreamClientEvent> {
    if (isTokenExpired()) {
      await authorizationService.refreshToken()
    }
    if (options.signal?.aborted) {
      yield { type: 'failure', kind: 'aborted', message: 'Streaming request was aborted' }
      return
    }

    const path = `/v1/chat/conversations/${encodeURIComponent(conversationId)}/messages`
    const body = {
      content,
      model,
      relayTokenId: tokenId,
      replaceMessageId: options.replaceMessageId,
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        for await (const transportEvent of appServerSseClient.stream<ChatStreamEvent>({
          url: path,
          init: {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify(body),
          },
          decode: parseChatStreamEvent,
          signal: options.signal,
          context: { path, body },
        })) {
          if (transportEvent.type === 'done') continue
          const event = transportEvent.value
          if (event.type === 'delta') yield { type: 'delta', content: event.content }
          else if (event.type === 'complete') {
            yield { type: 'complete', message: event.message }
            return
          } else if (event.type === 'error') {
            yield { type: 'failure', kind: 'server', message: event.error }
            return
          }
        }
        yield {
          type: 'failure',
          kind: 'protocol',
          message: 'SSE stream ended without a complete event',
        }
        return
      } catch (error) {
        if (
          error instanceof SseStreamError &&
          error.kind === 'http' &&
          error.status === 401 &&
          attempt === 0
        ) {
          await authorizationService.refreshToken()
          continue
        }
        const failure =
          error instanceof SseStreamError
            ? error
            : new SseStreamError(
                'network',
                error instanceof Error ? error.message : 'Streaming request failed',
              )
        yield { type: 'failure', kind: failure.kind, message: failure.message }
        return
      }
    }
  }

  async getAvailableTokens(): Promise<ChatTokenResponse[]> {
    const response = await chatApi.getAvailableTokens()
    return this.unwrapResponseData<ChatTokenResponse[]>(response) ?? []
  }
}

export const chatService = ChatService.getInstance()
