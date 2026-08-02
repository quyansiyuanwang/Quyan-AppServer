<template>
  <div v-if="isDesktop" class="chat-view">
    <ChatWindow
      v-if="chatStore.currentConversation"
      :conversation="chatStore.currentConversation"
      :messages="chatStore.messages"
      :tokens="chatStore.availableTokens"
      :sending="chatStore.isSending"
      @send="handleSend"
      @edit="handleEdit"
      @resend="handleResend"
      @regenerate="handleRegenerate"
      @delete="handleDeleteMessage"
      @stop="chatStore.stopGeneration"
    />
    <div v-else class="empty-state">
      <el-empty :description="i18ns.t('chat.selectOrCreate')" />
    </div>
    <ConversationList
      :conversations="chatStore.conversations"
      :current="chatStore.currentConversation"
      :has-more="chatStore.hasMoreConversations"
      :loading="chatStore.isLoading"
      @select="chatStore.selectConversation"
      @create="handleCreate"
      @rename="handleRenameConversation"
      @delete="handleDeleteConversation"
      @load-more="chatStore.loadConversations(false)"
    />
  </div>
  <div v-else class="chat-mobile">
    <div class="mobile-header">
      <el-button class="header-icon-btn" circle @click="mobileDrawerVisible = true">
        <el-icon><Menu /></el-icon>
      </el-button>
      <div class="mobile-title">{{ mobileConversationTitle }}</div>
      <el-button class="header-icon-btn" type="primary" circle @click="handleCreate">
        <el-icon><Plus /></el-icon>
      </el-button>
    </div>

    <div class="mobile-content">
      <ChatWindow
        v-if="chatStore.currentConversation"
        :conversation="chatStore.currentConversation"
        :messages="chatStore.messages"
        :tokens="chatStore.availableTokens"
        :sending="chatStore.isSending"
        @send="handleSend"
        @edit="handleEdit"
        @resend="handleResend"
        @regenerate="handleRegenerate"
        @delete="handleDeleteMessage"
        @stop="chatStore.stopGeneration"
      />
      <div v-else class="empty-state mobile-empty-state">
        <el-empty :description="i18ns.t('chat.selectOrCreate')">
          <el-button type="primary" @click="handleCreate">{{
            i18ns.t('chat.newConversation')
          }}</el-button>
        </el-empty>
      </div>
    </div>

    <el-drawer
      v-model="mobileDrawerVisible"
      direction="ltr"
      size="86%"
      :with-header="false"
      class="mobile-conversation-drawer"
    >
      <ConversationList
        :conversations="chatStore.conversations"
        :current="chatStore.currentConversation"
        :has-more="chatStore.hasMoreConversations"
        :loading="chatStore.isLoading"
        @select="handleSelectConversation"
        @create="handleCreate"
        @rename="handleRenameConversation"
        @delete="handleDeleteConversation"
        @load-more="chatStore.loadConversations(false)"
      />
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, computed } from 'vue'
import { ElMessageBox } from 'element-plus'
import { useChatStore } from '@/stores/chatStore'
import { usePageDevice } from '@/composables/usePageDevice'
import { i18ns } from '@/locales'
import { Menu, Plus } from '@element-plus/icons-vue'
import ConversationList from './components/ConversationList.vue'
import ChatWindow from './components/ChatWindow.vue'
import type { Message } from '@/types/chat'

const chatStore = useChatStore()
const { isDesktop } = usePageDevice()
const mobileDrawerVisible = ref(false)

const mobileConversationTitle = computed(() => {
  return chatStore.currentConversation?.title || i18ns.t('chat.newConversationTitle')
})

onMounted(async () => {
  await chatStore.loadConversations()
  await chatStore.loadAvailableTokens()
})

onBeforeUnmount(() => {
  chatStore.cancelActiveRequest()
})

async function handleCreate() {
  const { value } = await ElMessageBox.prompt(
    i18ns.t('chat.enterConversationTitle'),
    i18ns.t('chat.newConversation'),
    {
      confirmButtonText: i18ns.t('confirm'),
      cancelButtonText: i18ns.t('cancel'),
      inputValue: i18ns.t('chat.newConversationTitle'),
      inputValidator: (rawValue) => {
        if (!rawValue?.trim()) return i18ns.t('chat.titleRequired')
        return true
      },
    },
  ).catch(() => ({ value: '' }))

  const title = value?.trim()
  if (!title) return

  const conversation = await chatStore.createConversation(title)
  await chatStore.selectConversation(conversation.id)
  mobileDrawerVisible.value = false
}

async function handleRenameConversation(id: string, currentTitle: string | null) {
  const { value } = await ElMessageBox.prompt(
    i18ns.t('chat.enterConversationTitle'),
    i18ns.t('chat.renameConversation'),
    {
      confirmButtonText: i18ns.t('confirm'),
      cancelButtonText: i18ns.t('cancel'),
      inputValue: currentTitle || '',
      inputValidator: (rawValue) => {
        if (!rawValue?.trim()) return i18ns.t('chat.titleRequired')
        return true
      },
    },
  ).catch(() => ({ value: '' }))

  const title = value?.trim()
  if (!title) return

  await chatStore.renameConversation(id, title)
}

async function handleDeleteConversation(id: string) {
  const confirmed = await ElMessageBox.confirm(
    i18ns.t('chat.confirmDeleteConversation'),
    i18ns.t('warning'),
    {
      confirmButtonText: i18ns.t('confirm'),
      cancelButtonText: i18ns.t('cancel'),
      type: 'warning',
    },
  )
    .then(() => true)
    .catch(() => false)

  if (!confirmed) return

  await chatStore.deleteConversation(id)
}

async function handleSelectConversation(id: string) {
  await chatStore.selectConversation(id)
  mobileDrawerVisible.value = false
}

async function handleSend(content: string, model: string, tokenId?: string) {
  await chatStore.sendMessage(content, model, tokenId)
}

function handleEdit(message: Message, newContent: string) {
  chatStore.editMessage(message.id, newContent)
}

function handleResend(message: Message) {
  chatStore.resendMessage(message)
}

function handleRegenerate(message: Message) {
  chatStore.regenerateMessage(message)
}

function handleDeleteMessage(id: string) {
  chatStore.deleteMessage(id)
}
</script>

<style scoped>
.chat-view {
  display: flex;
  height: 100%;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}

.chat-mobile {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: linear-gradient(
    180deg,
    var(--color-background) 0%,
    var(--color-background-soft) 100%
  );
}

.mobile-header {
  height: 56px;
  display: grid;
  grid-template-columns: 44px 1fr 44px;
  align-items: center;
  gap: 10px;
  padding: 0 12px;
  border-bottom: 1px solid var(--color-border);
  background: var(--surface-card-bg);
  backdrop-filter: blur(10px);
}

.header-icon-btn {
  width: 36px;
  height: 36px;
}

.mobile-title {
  text-align: center;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-heading);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mobile-content {
  min-height: 0;
  min-width: 0;
  flex: 1;
  display: flex;
  overflow: hidden;
}

.empty-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.mobile-empty-state {
  padding: 0 20px;
}

@media (max-width: 768px) {
  .chat-mobile {
    background: var(--color-background);
  }

  .mobile-header {
    position: sticky;
    top: 0;
    z-index: 2;
  }
}

@media (max-width: 480px) {
  .mobile-header {
    padding: 0 10px;
  }
}

.mobile-conversation-drawer :deep(.el-drawer__body) {
  padding: 0;
}

.mobile-conversation-drawer :deep(.conversation-list) {
  width: 100%;
  height: 100%;
  border-left: none;
}
</style>
