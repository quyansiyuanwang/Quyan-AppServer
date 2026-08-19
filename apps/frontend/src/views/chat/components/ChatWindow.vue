<template>
  <div class="chat-window">
    <div class="header">
      <h3>{{ conversation.title || i18ns.t('chat.newConversationTitle') }}</h3>
    </div>
    <el-scrollbar ref="scrollbar" class="messages" @scroll="handleMessagesScroll">
      <MessageItem
        v-for="msg in messages"
        :key="msg.id"
        :message="msg"
        :sending="sending"
        @copy="handleCopy"
        @edit="handleEdit"
        @resend="handleResend"
        @regenerate="handleRegenerate(msg)"
        @delete="handleDelete"
      />
    </el-scrollbar>
    <MessageInput
      :tokens="tokens"
      :workspaces="workspaces"
      :agent-mode="agentMode"
      :sending="sending"
      @send="handleSend"
      @stop="emit('stop')"
      @create-workspace="emit('create-workspace')"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'
import type { Conversation, Message, ChatToken } from '@/types/chat'
import MessageItem from './MessageItem.vue'
import MessageInput from './MessageInput.vue'
import { i18ns } from '@/locales'

const props = defineProps<{
  conversation: Conversation
  messages: Message[]
  tokens: ChatToken[]
  workspaces?: { id: string; name: string }[]
  agentMode?: boolean
  sending?: boolean
}>()

const emit = defineEmits<{
  send: [
    content: string,
    model: string,
    tokenId?: string,
    agentMode?: boolean,
    workspaceId?: string,
  ]
  edit: [message: Message, newContent: string]
  resend: [message: Message]
  regenerate: [message: Message]
  delete: [id: string]
  stop: []
  'create-workspace': []
}>()

const SCROLL_BOTTOM_THRESHOLD = 24
const scrollbar = ref<any>()
const stickToBottom = ref(true)
let contentResizeObserver: ResizeObserver | null = null
let contentMutationObserver: MutationObserver | null = null
let stickyScrollRafId: number | null = null

function getScrollbarWrapElement(): HTMLElement | null {
  const wrapRef = scrollbar.value?.wrapRef as HTMLElement | undefined
  if (wrapRef) return wrapRef

  const legacyWrapRef = scrollbar.value?.$refs?.wrap as HTMLElement | undefined
  return legacyWrapRef || null
}

function isNearBottom(): boolean {
  const wrapElement = getScrollbarWrapElement()
  if (!wrapElement) return true

  const distanceToBottom =
    wrapElement.scrollHeight - (wrapElement.scrollTop + wrapElement.clientHeight)
  return distanceToBottom <= SCROLL_BOTTOM_THRESHOLD
}

function scrollToBottom(force = false) {
  if (!force && !stickToBottom.value) return

  const wrapElement = getScrollbarWrapElement()
  if (!wrapElement) return

  scrollbar.value?.setScrollTop(wrapElement.scrollHeight)
}

function queueStickyScroll() {
  if (!stickToBottom.value) return
  if (stickyScrollRafId != null) return

  stickyScrollRafId = requestAnimationFrame(() => {
    stickyScrollRafId = null
    scrollToBottom(true)
  })
}

function observeContentResize() {
  const wrapElement = getScrollbarWrapElement()
  const contentElement = wrapElement?.firstElementChild as HTMLElement | null
  if (!contentElement) return

  contentResizeObserver?.disconnect()
  contentResizeObserver = new ResizeObserver(() => {
    if (!stickToBottom.value) return
    queueStickyScroll()
  })
  contentResizeObserver.observe(contentElement)
}

function observeContentMutations() {
  const wrapElement = getScrollbarWrapElement()
  const contentElement = wrapElement?.firstElementChild as HTMLElement | null
  if (!contentElement) return

  contentMutationObserver?.disconnect()
  contentMutationObserver = new MutationObserver(() => {
    if (!stickToBottom.value) return
    queueStickyScroll()
  })

  contentMutationObserver.observe(contentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  })
}

function handleMessagesScroll() {
  const nearBottom = isNearBottom()
  if (nearBottom) {
    stickToBottom.value = true
    return
  }

  // While streaming, if we were already sticky, transient layout growth (e.g. code block creation)
  // should keep us attached to the bottom instead of dropping into free-scroll mode.
  if (props.sending && stickToBottom.value) {
    queueStickyScroll()
    return
  }

  stickToBottom.value = false
}

watch(
  () => props.conversation.id,
  () => {
    nextTick(() => {
      observeContentResize()
      observeContentMutations()
      stickToBottom.value = true
      scrollToBottom(true)
    })
  },
  { immediate: true },
)

watch(
  [() => props.messages.length, () => props.messages[props.messages.length - 1]?.content],
  () => {
    const shouldStick = stickToBottom.value || isNearBottom()

    nextTick(() => {
      if (!shouldStick) return
      stickToBottom.value = true
      scrollToBottom(true)
      queueStickyScroll()
    })
  },
)

watch(
  () => props.messages.length,
  (newLength, oldLength) => {
    if (newLength <= oldLength) return

    const lastMessage = props.messages[newLength - 1]
    if (!lastMessage || lastMessage.role !== 'assistant') return
    if (!props.sending) return

    nextTick(() => {
      stickToBottom.value = true
      scrollToBottom(true)
    })
  },
)

function handleSend(
  content: string,
  model: string,
  tokenId?: string,
  agentMode?: boolean,
  workspaceId?: string,
) {
  emit('send', content, model, tokenId, agentMode, workspaceId)
}

onMounted(() => {
  nextTick(() => {
    observeContentResize()
    observeContentMutations()
  })
})

onBeforeUnmount(() => {
  contentResizeObserver?.disconnect()
  contentResizeObserver = null
  contentMutationObserver?.disconnect()
  contentMutationObserver = null
  if (stickyScrollRafId != null) {
    cancelAnimationFrame(stickyScrollRafId)
    stickyScrollRafId = null
  }
})

function handleCopy(content: string) {
  navigator.clipboard.writeText(content)
  ElMessage.success(i18ns.t('copy'))
}

function handleEdit(message: Message, newContent: string) {
  emit('edit', message, newContent)
}

function handleResend(message: Message) {
  emit('resend', message)
}

function handleRegenerate(message: Message) {
  emit('regenerate', message)
}

async function handleDelete(id: string) {
  emit('delete', id)
}
</script>

<style scoped>
.chat-window {
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}
.header {
  padding: 16px 24px;
  border-bottom: 1px solid var(--color-border);
  background: var(--surface-card-bg);
}
.header h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 500;
}
.messages {
  flex: 1;
  min-height: 0;
  background: var(--color-background-soft);
}

.messages :deep(.el-scrollbar__view) {
  min-height: 100%;
  padding: 16px 24px;
}

@media (max-width: 768px) {
  .header {
    display: none;
  }

  .header {
    padding: 10px 12px;
  }

  .header h3 {
    font-size: 15px;
  }

  .messages {
    min-width: 0;
  }

  .messages :deep(.el-scrollbar__view) {
    padding: 10px 12px;
  }
}
</style>
