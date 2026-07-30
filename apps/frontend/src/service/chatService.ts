import { TypedLocalStorage } from '@/utils/typedLocalStorage'
import { useRequestStore } from '@/stores/request'
import { isTokenExpired } from '@/stores/request'
import StorageKey from '@/constant/storagekey'
import { authorizationService } from '@/service/authorizationService'
import type { ChatTokenResponse, ConversationResponse, MessageResponse } from '@/client/types.gen'
import { cacheObject } from '@/utils/common'
import { createChatControllerApi } from '@/client/services/chat-controller.gen'

const chatApi = cacheObject(() => createChatControllerApi(useRequestStore().getAxios()))

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

  async sendMessageStream(
    conversationId: string,
    content: string,
    model: string,
    tokenId: string | undefined,
    onChunk: (chunk: string) => void,
    onComplete: (message: MessageResponse) => void,
    onError: (error: Error) => void,
    options: { signal?: AbortSignal; replaceMessageId?: string; retryCount?: number } = {},
  ): Promise<'completed' | 'aborted' | 'failed'> {
    if (isTokenExpired()) {
      await authorizationService.refreshToken()
    }
    if (options.signal?.aborted) return 'aborted'

    const token = TypedLocalStorage.getItem(StorageKey.Auth.ACCESS_TOKEN)
    const path = `/v1/chat/conversations/${encodeURIComponent(conversationId)}/messages`
    const body = { content, model, relayTokenId: tokenId, replaceMessageId: options.replaceMessageId }
    const request = await useRequestStore().prepareStreamingRequest(path, body)

    let response: Response
    try {
      response = await fetch(request.url, {
      method: 'POST',
      headers: {
        ...request.headers,
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      credentials: 'include',
      body: JSON.stringify(body),
      signal: options.signal,
      })
    } catch (error) {
      if (options.signal?.aborted || (error as { name?: string })?.name === 'AbortError') return 'aborted'
      onError(error instanceof Error ? error : new Error(String(error)))
      return 'failed'
    }

    if (!response.ok) {
      if (response.status === 401 && (options.retryCount || 0) === 0) {
        await authorizationService.refreshToken()
        return this.sendMessageStream(
          conversationId,
          content,
          model,
          tokenId,
          onChunk,
          onComplete,
          onError,
          { ...options, retryCount: 1 },
        )
      }
      const errText = await response.text()
      try {
        const payload = JSON.parse(errText) as { message?: string }
        onError(new Error(payload.message || `HTTP ${response.status}`))
      } catch {
        onError(new Error(errText || `HTTP ${response.status}`))
      }
      return 'failed'
    }

    const reader = response.body?.getReader()
    const decoder = new TextDecoder()

    if (!reader) {
      onError(new Error('No response body'))
      return 'failed'
    }

    try {
      let buffer = ''
      let streamCompleted = false
      const processFrame = (frame: string) => {
        const data = frame
          .replace(/\r/g, '')
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n')
        if (!data) return
        if (data === '[DONE]') {
          streamCompleted = true
          return
        }

        try {
          const parsed = JSON.parse(data) as { content?: string; done?: boolean; message?: MessageResponse; error?: string }
          if (parsed.error) {
            onError(new Error(parsed.error))
            streamCompleted = true
            return
          }
          if (parsed.content) onChunk(parsed.content)
          if (parsed.done && parsed.message) onComplete(parsed.message)
        } catch {
          onError(new Error('Invalid streaming response'))
          streamCompleted = true
        }
      }

      const flushFrames = (isFinal = false) => {
        const frames = buffer.split(/\r?\n\r?\n/)
        buffer = isFinal ? '' : (frames.pop() ?? '')
        for (const frame of frames) {
          processFrame(frame)
          if (streamCompleted) return
        }
        if (isFinal && buffer.trim()) processFrame(buffer)
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        flushFrames()
        if (streamCompleted) return 'completed'
      }
      buffer += decoder.decode()
      flushFrames(true)
      return options.signal?.aborted ? 'aborted' : 'completed'
    } catch (error: any) {
      if (options.signal?.aborted || error?.name === 'AbortError') return 'aborted'
      onError(error instanceof Error ? error : new Error(String(error)))
      return 'failed'
    } finally {
      reader.releaseLock()
    }
  }

  async getAvailableTokens(): Promise<ChatTokenResponse[]> {
    const response = await chatApi.getAvailableTokens()
    return this.unwrapResponseData<ChatTokenResponse[]>(response) ?? []
  }
}

export const chatService = ChatService.getInstance()
