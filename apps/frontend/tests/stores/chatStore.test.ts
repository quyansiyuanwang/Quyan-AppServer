import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Conversation, Message } from '@/types/chat'

const { sendMessageStreamMock, deleteMessageMock } = vi.hoisted(() => ({
  sendMessageStreamMock: vi.fn(),
  deleteMessageMock: vi.fn(),
}))

vi.mock('@/service/chatService', () => ({
  chatService: {
    getConversations: vi.fn(),
    createConversation: vi.fn(),
    getMessages: vi.fn(),
    sendMessageStream: sendMessageStreamMock,
    deleteConversation: vi.fn(),
    updateConversation: vi.fn(),
    deleteMessage: deleteMessageMock,
    getAvailableTokens: vi.fn(),
  },
}))

import { useChatStore } from '@/stores/chatStore'

const conversation = {
  id: 'conversation-1',
  title: 'Test',
  relayTokenId: 'token-1',
} as Conversation

const createMessage = (overrides: Partial<Message>): Message =>
  ({
    id: 'message-1',
    conversationId: conversation.id,
    role: 'user',
    content: 'hello',
    model: null,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    createTime: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }) as Message

describe('chatStore model selection', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    sendMessageStreamMock.mockResolvedValue(undefined)
    deleteMessageMock.mockResolvedValue(undefined)
  })

  it('does not optimistically mutate or send when the token advertises no models', async () => {
    const store = useChatStore()
    store.currentConversation = conversation
    store.availableTokens = [{ id: 'token-1', name: 'Token', allowedModels: '' } as any]

    await store.sendMessage('hello', 'stale-model', 'token-1')

    expect(sendMessageStreamMock).not.toHaveBeenCalled()
    expect(store.messages).toEqual([])
    expect(store.isSending).toBe(false)
  })

  it('replaces a stale requested model with the first currently advertised model', async () => {
    const store = useChatStore()
    store.currentConversation = conversation
    store.availableTokens = [
      { id: 'token-1', name: 'Token', allowedModels: 'current-model,other-model' } as any,
    ]

    await store.sendMessage('hello', 'stale-model', 'token-1')

    expect(sendMessageStreamMock).toHaveBeenCalledWith(
      conversation.id,
      'hello',
      'current-model',
      'token-1',
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it('does not resend after the selected token loses all models', async () => {
    const store = useChatStore()
    store.currentConversation = conversation
    store.availableTokens = [{ id: 'token-1', name: 'Token', allowedModels: '' } as any]
    const message = createMessage({ model: 'stale-model' })
    store.messages = [message]

    await store.resendMessage(message)

    expect(sendMessageStreamMock).not.toHaveBeenCalled()
    expect(store.messages).toEqual([message])
  })

  it('does not delete or regenerate after the selected token loses all models', async () => {
    const store = useChatStore()
    store.currentConversation = conversation
    store.availableTokens = [{ id: 'token-1', name: 'Token', allowedModels: '' } as any]
    const userMessage = createMessage({ id: 'user-1', role: 'user' })
    const assistantMessage = createMessage({
      id: 'assistant-1',
      role: 'assistant',
      content: 'answer',
      model: 'stale-model',
    })
    store.messages = [userMessage, assistantMessage]

    await store.regenerateMessage(assistantMessage)

    expect(deleteMessageMock).not.toHaveBeenCalled()
    expect(sendMessageStreamMock).not.toHaveBeenCalled()
    expect(store.messages).toEqual([userMessage, assistantMessage])
  })

  it('stops the active stream without turning the assistant draft into an error message', async () => {
    const store = useChatStore()
    store.currentConversation = conversation
    store.availableTokens = [{ id: 'token-1', name: 'Token', allowedModels: 'current-model' } as any]
    sendMessageStreamMock.mockImplementation(
      (...args: any[]) =>
        new Promise((resolve) => {
          const options = args[7] as { signal: AbortSignal }
          options.signal.addEventListener('abort', () => resolve('aborted'))
        }),
    )

    const pending = store.sendMessage('hello', 'current-model', 'token-1')
    await Promise.resolve()
    expect(store.isSending).toBe(true)

    store.stopGeneration()
    await pending

    expect(store.isSending).toBe(false)
    expect(store.messages.at(-1)).toMatchObject({ role: 'assistant', clientState: 'stopped' })
  })
})
