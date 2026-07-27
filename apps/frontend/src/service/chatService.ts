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
    retryCount = 0,
  ): Promise<void> {
    if (isTokenExpired()) {
      await authorizationService.refreshToken()
    }
    const token = TypedLocalStorage.getItem(StorageKey.Auth.ACCESS_TOKEN)
    const url = `${import.meta.env.VITE_BACKEND_URL}/v1/chat/conversations/${conversationId}/messages`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ content, model, relayTokenId: tokenId }),
    })

    if (!response.ok) {
      if (response.status === 401 && retryCount === 0) {
        await authorizationService.refreshToken()
        return this.sendMessageStream(
          conversationId,
          content,
          model,
          tokenId,
          onChunk,
          onComplete,
          onError,
          1,
        )
      }
      const errText = await response.text()
      onError(new Error(errText || `HTTP ${response.status}`))
      return
    }

    const reader = response.body?.getReader()
    const decoder = new TextDecoder()

    if (!reader) {
      onError(new Error('No response body'))
      return
    }

    try {
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            console.log('[ChatService] Received data:', data)
            if (data === '[DONE]') return

            try {
              const parsed = JSON.parse(data)
              console.log('[ChatService] Parsed:', parsed)
              if (parsed.error) {
                onError(new Error(parsed.error))
                return
              }
              if (parsed.content) {
                console.log('[ChatService] Calling onChunk with:', parsed.content)
                onChunk(parsed.content)
              }
              if (parsed.done && parsed.message) {
                console.log('[ChatService] Calling onComplete with:', parsed.message)
                onComplete(parsed.message as MessageResponse)
              }
            } catch (e) {
              console.error('[ChatService] Parse error:', e)
            }
          }
        }
      }
    } catch (error: any) {
      console.error('[ChatService] Stream error:', error)
      onError(error)
    }
  }

  async getAvailableTokens(): Promise<ChatTokenResponse[]> {
    const response = await chatApi.getAvailableTokens()
    return this.unwrapResponseData<ChatTokenResponse[]>(response) ?? []
  }
}

export const chatService = ChatService.getInstance()
