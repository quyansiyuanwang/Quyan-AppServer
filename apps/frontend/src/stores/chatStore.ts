import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Conversation, Message, ChatToken } from '@/types/chat'
import { chatService } from '@/service/chatService'
import StorageKey from '@/constant/storagekey'
import { TypedLocalStorage } from '@/utils/typedLocalStorage'
import { getScopedStorageKey } from '@/utils/storageScope'

export const useChatStore = defineStore('chat', () => {
  const conversations = ref<Conversation[]>([])
  const currentConversation = ref<Conversation | null>(null)
  const messages = ref<Message[]>([])
  const availableTokens = ref<ChatToken[]>([])
  const isLoading = ref(false)
  const isSending = ref(false)
  const pendingDeletedMessageIds = ref<Set<string>>(new Set())

  const parseAllowedModels = (allowedModels?: string | null): string[] => {
    if (!allowedModels) return []
    return allowedModels
      .split(',')
      .map((model) => model.trim())
      .filter(Boolean)
  }

  const getSelectionFromStorage = (): { tokenId?: string; model?: string } => {
    const tokenStorageKey = getScopedStorageKey(StorageKey.Chat.SELECTED_TOKEN_ID)
    const modelStorageKey = getScopedStorageKey(StorageKey.Chat.SELECTED_MODEL)
    const selectedTokenId = TypedLocalStorage.getItem(tokenStorageKey) || undefined
    const selectedModel = TypedLocalStorage.getItem(modelStorageKey) || undefined

    const token =
      availableTokens.value.find((item) => item.id === selectedTokenId) ||
      availableTokens.value.find((item) => item.id === currentConversation.value?.relayTokenId) ||
      availableTokens.value[0]

    if (!token) return { tokenId: undefined, model: selectedModel }

    const tokenModels = parseAllowedModels(token.allowedModels)
    const model =
      selectedModel && tokenModels.includes(selectedModel)
        ? selectedModel
        : tokenModels[0] || selectedModel

    return { tokenId: token.id, model }
  }

  const filterPendingDeletedMessages = (items: Message[]) => {
    if (!pendingDeletedMessageIds.value.size) return items
    return items.filter((message) => !pendingDeletedMessageIds.value.has(message.id))
  }

  async function loadConversations() {
    isLoading.value = true
    try {
      const result = await chatService.getConversations()
      conversations.value = result?.conversations ?? []
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
    currentConversation.value = conversations.value.find((c) => c.id === id) || null
    if (currentConversation.value) {
      await loadMessages(id)
    }
  }

  async function loadMessages(conversationId: string) {
    const loaded = (await chatService.getMessages(conversationId)) ?? []
    messages.value = filterPendingDeletedMessages(loaded)
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
    if (models.length === 0) return null
    const fallbackModel = models[0]
    if (!fallbackModel) return null
    return {
      tokenId: token.id,
      model: requestedModel && models.includes(requestedModel) ? requestedModel : fallbackModel,
    }
  }

  async function sendMessage(content: string, model: string, tokenId?: string) {
    if (!currentConversation.value) return
    if (isSending.value) return

    const selection = resolveAvailableSelection(tokenId, model)
    if (!selection) return

    isSending.value = true

    const userMessage: Message = {
      id: Date.now().toString(),
      conversationId: currentConversation.value.id,
      role: 'user',
      content,
      model: null,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      createTime: new Date().toISOString(),
    }
    messages.value.push(userMessage)

    const assistantMessageIndex = messages.value.length
    messages.value.push({
      id: (Date.now() + 1).toString(),
      conversationId: currentConversation.value.id,
      role: 'assistant',
      content: '',
      model: null,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      createTime: new Date().toISOString(),
    })

    try {
      await chatService.sendMessageStream(
        currentConversation.value.id,
        content,
        selection.model,
        selection.tokenId,
        (chunk) => {
          console.log('[ChatStore] onChunk called with:', chunk)
          const assistantMessage = messages.value[assistantMessageIndex]
          if (!assistantMessage) return
          assistantMessage.content += chunk
        },
        (message) => {
          console.log('[ChatStore] onComplete called with:', message)
          const assistantMessage = messages.value[assistantMessageIndex]
          if (!assistantMessage) return
          assistantMessage.id = message.id
          assistantMessage.model = message.model
          assistantMessage.inputTokens = message.inputTokens
          assistantMessage.outputTokens = message.outputTokens
          assistantMessage.totalTokens = message.totalTokens
          assistantMessage.createTime = message.createTime
          // 重新加载消息列表以确保同步
          if (currentConversation.value) {
            loadMessages(currentConversation.value.id)
          }
        },
        (error) => {
          console.error('[ChatStore] onError called with:', error)
          const assistantMessage = messages.value[assistantMessageIndex]
          if (!assistantMessage) return
          assistantMessage.content = `Error: ${error.message}`
        },
      )
    } finally {
      isSending.value = false
    }
  }

  async function deleteConversation(id: string) {
    await chatService.deleteConversation(id)
    conversations.value = conversations.value.filter((c) => c.id !== id)
    if (currentConversation.value?.id === id) {
      currentConversation.value = null
      messages.value = []
    }
  }

  async function renameConversation(id: string, title: string) {
    const conversation = await chatService.updateConversation(id, title)
    if (!conversation) throw new Error('Failed to update conversation')

    const index = conversations.value.findIndex((item) => item.id === id)
    if (index !== -1) {
      conversations.value[index] = conversation
    }

    if (currentConversation.value?.id === id) {
      currentConversation.value = conversation
    }

    return conversation
  }

  async function deleteMessage(id: string): Promise<boolean> {
    pendingDeletedMessageIds.value.add(id)
    messages.value = messages.value.filter((m) => m.id !== id)

    try {
      await chatService.deleteMessage(id)
      return true
    } catch (error: any) {
      const statusCode = Number(error?.response?.status || 0)

      // Message already removed on server; treat as successful deletion.
      if (statusCode === 404) return true

      pendingDeletedMessageIds.value.delete(id)
      if (currentConversation.value) await loadMessages(currentConversation.value.id)
      return false
    } finally {
      pendingDeletedMessageIds.value.delete(id)
    }
  }

  function editMessage(id: string, newContent: string) {
    const msg = messages.value.find((m) => m.id === id)
    if (msg) {
      msg.content = newContent
    }
  }

  async function resendMessage(message: Message) {
    if (!currentConversation.value) return
    const storedSelection = getSelectionFromStorage()
    const selection = resolveAvailableSelection(
      storedSelection.tokenId || currentConversation.value.relayTokenId || undefined,
      storedSelection.model || message.model || undefined,
    )
    if (!selection) {
      console.error('[ChatStore] No token available for resend')
      return
    }
    await sendMessage(message.content, selection.model, selection.tokenId)
  }

  async function regenerateMessage(assistantMessage: Message) {
    if (!currentConversation.value) return
    if (isSending.value) return

    const msgIndex = messages.value.findIndex((m) => m.id === assistantMessage.id)
    if (msgIndex === -1 || msgIndex === 0) return
    const userMessage = messages.value[msgIndex - 1]
    if (!userMessage || userMessage.role !== 'user') return

    const storedSelection = getSelectionFromStorage()
    const selection = resolveAvailableSelection(
      storedSelection.tokenId || currentConversation.value.relayTokenId || undefined,
      storedSelection.model || assistantMessage.model || userMessage.model || undefined,
    )
    if (!selection) {
      console.error('[ChatStore] No token available for regenerate')
      return
    }

    // Remove the old QA pair first, then send once to avoid duplicating the user message.
    const deletedAssistant = await deleteMessage(assistantMessage.id)
    const deletedUser = await deleteMessage(userMessage.id)
    if (!deletedAssistant || !deletedUser) return
    await sendMessage(userMessage.content, selection.model, selection.tokenId)
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
    loadConversations,
    createConversation,
    selectConversation,
    loadMessages,
    sendMessage,
    deleteConversation,
    renameConversation,
    deleteMessage,
    editMessage,
    resendMessage,
    regenerateMessage,
    loadAvailableTokens,
  }
})
