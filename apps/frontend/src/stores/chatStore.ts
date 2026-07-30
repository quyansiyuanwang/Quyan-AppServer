import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Conversation, Message, ChatToken } from '@/types/chat'
import { chatService } from '@/service/chatService'
import StorageKey from '@/constant/storagekey'
import { TypedLocalStorage } from '@/utils/typedLocalStorage'
import { getScopedStorageKey } from '@/utils/storageScope'

type MessageClientState = 'streaming' | 'failed' | 'stopped'
type ChatMessage = Message & { clientState?: MessageClientState; errorMessage?: string }

interface ActiveChatRequest {
  id: number
  conversationId: string
  controller: AbortController
  assistantDraftId: string
}

export const useChatStore = defineStore('chat', () => {
  const conversations = ref<Conversation[]>([])
  const currentConversation = ref<Conversation | null>(null)
  const messages = ref<ChatMessage[]>([])
  const availableTokens = ref<ChatToken[]>([])
  const isLoading = ref(false)
  const isSending = ref(false)
  const conversationPage = ref(1)
  const hasMoreConversations = ref(true)
  let requestVersion = 0
  let messageLoadVersion = 0
  let activeRequest: ActiveChatRequest | null = null

  const parseAllowedModels = (allowedModels?: string | null): string[] =>
    (allowedModels || '')
      .split(',')
      .map((model) => model.trim())
      .filter(Boolean)

  const getSelectionFromStorage = (): { tokenId?: string; model?: string } => ({
    tokenId: TypedLocalStorage.getItem(getScopedStorageKey(StorageKey.Chat.SELECTED_TOKEN_ID)) || undefined,
    model: TypedLocalStorage.getItem(getScopedStorageKey(StorageKey.Chat.SELECTED_MODEL)) || undefined,
  })

  const isCurrentRequest = (id: number, conversationId: string) =>
    activeRequest?.id === id && activeRequest.conversationId === conversationId

  function cancelActiveRequest(conversationId?: string) {
    if (!activeRequest || (conversationId && activeRequest.conversationId !== conversationId)) return
    const draft = messages.value.find((item) => item.id === activeRequest?.assistantDraftId)
    if (draft) draft.clientState = 'stopped'
    activeRequest.controller.abort()
  }

  async function loadConversations(reset = true) {
    if (isLoading.value || (!reset && !hasMoreConversations.value)) return
    isLoading.value = true
    const page = reset ? 1 : conversationPage.value + 1
    try {
      const result = await chatService.getConversations(page)
      const incoming = result?.conversations ?? []
      conversations.value = reset
        ? incoming
        : [...conversations.value, ...incoming.filter((item) => !conversations.value.some((old) => old.id === item.id))]
      conversationPage.value = page
      hasMoreConversations.value = conversations.value.length < (result?.total ?? 0)
    } finally {
      isLoading.value = false
    }
  }

  async function createConversation(title?: string, tokenId?: string) {
    const conversation = await chatService.createConversation(title, tokenId)
    if (!conversation) throw new Error('Failed to create conversation')
    conversations.value.unshift(conversation)
    return conversation
  }

  async function selectConversation(id: string) {
    if (currentConversation.value?.id === id) return
    cancelActiveRequest()
    currentConversation.value = conversations.value.find((conversation) => conversation.id === id) || null
    messages.value = []
    if (currentConversation.value) await loadMessages(id)
  }

  async function loadMessages(conversationId: string) {
    const loadId = ++messageLoadVersion
    const loaded = (await chatService.getMessages(conversationId)) ?? []
    if (loadId !== messageLoadVersion || currentConversation.value?.id !== conversationId) return
    messages.value = loaded as ChatMessage[]
  }

  function resolveAvailableSelection(
    tokenId?: string,
    requestedModel?: string,
  ): { tokenId: string; model: string } | null {
    const token =
      availableTokens.value.find((item) => item.id === tokenId) ||
      availableTokens.value.find((item) => item.id === currentConversation.value?.relayTokenId) ||
      availableTokens.value[0]
    if (!token) return null

    const models = parseAllowedModels(token.allowedModels)
    if (!models.length) return null
    return { tokenId: token.id, model: requestedModel && models.includes(requestedModel) ? requestedModel : models[0]! }
  }

  const createDraft = (conversationId: string, role: 'user' | 'assistant', content: string, id: string): ChatMessage => ({
    id,
    conversationId,
    role,
    content,
    model: null,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    completionStatus: 'completed',
    createTime: new Date().toISOString(),
  })

  async function sendMessage(content: string, model: string, tokenId?: string, replaceMessageId?: string) {
    const conversation = currentConversation.value
    if (!conversation || isSending.value) return
    const selection = resolveAvailableSelection(tokenId, model)
    if (!selection) return

    const requestId = ++requestVersion
    const draftId = `chat-draft-${requestId}`
    const controller = new AbortController()
    activeRequest = { id: requestId, conversationId: conversation.id, controller, assistantDraftId: draftId }
    isSending.value = true

    if (replaceMessageId) {
      const messageIndex = messages.value.findIndex((message) => message.id === replaceMessageId)
      if (messageIndex < 0 || messages.value[messageIndex]?.role !== 'user') {
        activeRequest = null
        isSending.value = false
        return
      }
      messages.value = messages.value.slice(0, messageIndex + 1)
      messages.value[messageIndex]!.content = content
    } else messages.value.push(createDraft(conversation.id, 'user', content, `chat-user-draft-${requestId}`))

    const assistantDraft = createDraft(conversation.id, 'assistant', '', draftId)
    assistantDraft.clientState = 'streaming'
    messages.value.push(assistantDraft)

    const getDraft = () =>
      isCurrentRequest(requestId, conversation.id)
        ? messages.value.find((message) => message.id === draftId)
        : undefined

    try {
      const result = await chatService.sendMessageStream(
        conversation.id,
        content,
        selection.model,
        selection.tokenId,
        (chunk) => {
          const draft = getDraft()
          if (draft) draft.content += chunk
        },
        (message) => {
          const draft = getDraft()
          if (!draft) return
          Object.assign(draft, message)
          delete draft.clientState
          void loadMessages(conversation.id)
        },
        (error) => {
          const draft = getDraft()
          if (!draft) return
          draft.clientState = 'failed'
          draft.errorMessage = error.message
        },
        { signal: controller.signal, replaceMessageId },
      )

      if (result === 'aborted') {
        const draft = getDraft()
        if (draft) draft.clientState = 'stopped'
      }
    } finally {
      if (isCurrentRequest(requestId, conversation.id)) {
        activeRequest = null
        isSending.value = false
      }
    }
  }

  function stopGeneration() {
    cancelActiveRequest(currentConversation.value?.id)
  }

  async function deleteConversation(id: string) {
    cancelActiveRequest(id)
    await chatService.deleteConversation(id)
    conversations.value = conversations.value.filter((conversation) => conversation.id !== id)
    if (currentConversation.value?.id === id) {
      currentConversation.value = null
      messages.value = []
    }
  }

  async function renameConversation(id: string, title: string) {
    const conversation = await chatService.updateConversation(id, title)
    if (!conversation) throw new Error('Failed to update conversation')
    const index = conversations.value.findIndex((item) => item.id === id)
    if (index !== -1) conversations.value[index] = conversation
    if (currentConversation.value?.id === id) currentConversation.value = conversation
    return conversation
  }

  async function deleteMessage(id: string): Promise<boolean> {
    const index = messages.value.findIndex((message) => message.id === id)
    if (index < 0) return false
    const previous = messages.value
    messages.value = messages.value.slice(0, index)
    try {
      await chatService.deleteMessage(id)
      return true
    } catch {
      messages.value = previous
      return false
    }
  }

  async function editMessage(id: string, newContent: string) {
    const selection = getSelectionFromStorage()
    await sendMessage(newContent, selection.model || '', selection.tokenId, id)
  }

  async function resendMessage(message: Message) {
    const selection = getSelectionFromStorage()
    await sendMessage(message.content, selection.model || message.model || '', selection.tokenId, message.id)
  }

  async function regenerateMessage(assistantMessage: Message) {
    const index = messages.value.findIndex((message) => message.id === assistantMessage.id)
    const userMessage = index > 0 ? messages.value[index - 1] : undefined
    if (!userMessage || userMessage.role !== 'user') return
    const selection = getSelectionFromStorage()
    await sendMessage(userMessage.content, selection.model || assistantMessage.model || '', selection.tokenId, userMessage.id)
  }

  async function loadAvailableTokens() {
    availableTokens.value = (await chatService.getAvailableTokens()) ?? []
  }

  return {
    conversations,
    currentConversation,
    messages,
    availableTokens,
    isLoading,
    isSending,
    hasMoreConversations,
    loadConversations,
    createConversation,
    selectConversation,
    loadMessages,
    sendMessage,
    stopGeneration,
    cancelActiveRequest,
    deleteConversation,
    renameConversation,
    deleteMessage,
    editMessage,
    resendMessage,
    regenerateMessage,
    loadAvailableTokens,
  }
})
