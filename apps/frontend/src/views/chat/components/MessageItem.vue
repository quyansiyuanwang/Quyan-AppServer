<template>
  <div :class="['message-item', message.role]">
    <div class="message-wrapper">
      <div class="message-content" @click="handleClick">
        <div
          v-if="!isEditing"
          class="content chat-markdown"
          v-html="htmlContent"
          ref="contentRef"
        ></div>
        <el-input
          v-else
          v-model="editContent"
          type="textarea"
          :autosize="{ minRows: 2 }"
          @blur="handleEditBlur"
          @keydown.enter.exact.prevent="handleEditSubmit"
          @keydown.esc="cancelEdit"
          ref="editInput"
        />
      </div>
      <div class="actions-overlay">
        <el-button text size="small" @click.stop="handleCopy">
          <el-icon><CopyDocument /></el-icon>
        </el-button>
        <el-button v-if="message.role === 'user'" text size="small" @click.stop="handleResend">
          <el-icon><Refresh /></el-icon>
        </el-button>
        <el-button
          v-if="message.role === 'assistant'"
          text
          size="small"
          :disabled="sending"
          @click.stop="handleRegenerate"
        >
          <el-icon><Refresh /></el-icon>
        </el-button>
        <el-button text size="small" type="danger" @click.stop="handleDelete">
          <el-icon><Delete /></el-icon>
        </el-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, watch } from 'vue'
import { ElMessageBox, ElMessage } from 'element-plus'
import type { Message } from '@/types/chat'
import { CopyDocument, Refresh, Delete } from '@element-plus/icons-vue'
import { i18ns } from '@/locales'
import { highlightCodeBlocks, renderChatMarkdown } from '@/utils/asyncMarkdown'
import 'highlight.js/styles/github-dark.css'

const props = defineProps<{
  message: Message
  sending?: boolean
}>()

const emit = defineEmits<{
  copy: [content: string]
  edit: [message: Message, newContent: string]
  resend: [message: Message]
  regenerate: []
  delete: [id: string]
}>()

const isEditing = ref(false)
const editContent = ref('')
const editInput = ref()
const contentRef = ref<HTMLElement>()
const htmlContent = ref('')
let renderVersion = 0

async function addCopyButtons() {
  if (!contentRef.value) return
  await highlightCodeBlocks(contentRef.value)
  const codeBlocks = contentRef.value.querySelectorAll('pre code')
  codeBlocks.forEach((block) => {
    const pre = block.parentElement
    if (!pre || pre.querySelector('.code-copy-btn')) return

    const wrapper = document.createElement('div')
    wrapper.className = 'code-block-wrapper'

    const header = document.createElement('div')
    header.className = 'code-header'

    const lang = block.className.match(/language-(\w+)/)?.[1] || 'text'
    const langSpan = document.createElement('span')
    langSpan.className = 'code-lang'
    langSpan.textContent = lang

    const copyBtn = document.createElement('button')
    copyBtn.className = 'code-copy-btn'
    copyBtn.textContent = i18ns.t('copy')
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(block.textContent || '')
      ElMessage.success(i18ns.t('copySuccess'))
    }

    header.appendChild(langSpan)
    header.appendChild(copyBtn)

    pre.parentNode?.insertBefore(wrapper, pre)
    wrapper.appendChild(header)
    wrapper.appendChild(pre)
  })
}

async function renderMessageContent() {
  const currentRenderVersion = ++renderVersion
  const html = await renderChatMarkdown(props.message.content)
  if (currentRenderVersion !== renderVersion) return

  htmlContent.value = html
  await nextTick()
  if (currentRenderVersion !== renderVersion) return
  await addCopyButtons()
}

watch(
  () => props.message.content,
  () => {
    void renderMessageContent()
  },
  { immediate: true },
)

function handleClick() {
  if (props.message.role === 'user' && !isEditing.value) {
    startEdit()
  }
}

function startEdit() {
  isEditing.value = true
  editContent.value = props.message.content
  nextTick(() => {
    editInput.value?.focus()
  })
}

function cancelEdit() {
  isEditing.value = false
  editContent.value = ''
}

function handleEditBlur() {
  if (editContent.value === props.message.content) {
    cancelEdit()
  }
}

function handleEditSubmit() {
  if (editContent.value.trim() && editContent.value !== props.message.content) {
    emit('edit', props.message, editContent.value)
  }
  cancelEdit()
}

function handleCopy() {
  emit('copy', props.message.content)
}

function handleResend() {
  emit('resend', props.message)
}

function handleRegenerate() {
  emit('regenerate')
}

async function handleDelete() {
  await ElMessageBox.confirm(i18ns.t('chat.confirmDelete'), {
    type: 'warning',
  })
  emit('delete', props.message.id)
}
</script>

<style scoped>
.message-item {
  display: flex;
  margin: 12px 0;
}
.message-item.user {
  justify-content: flex-end;
}
.message-item.assistant {
  justify-content: flex-start;
}
.message-wrapper {
  display: flex;
  flex-direction: column;
  max-width: 70%;
}
.message-content {
  padding: 12px 16px;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s;
  width: fit-content;
}
.message-item.user .message-content {
  background: var(--el-color-primary-light-9);
  align-self: flex-end;
}
.message-item.assistant .message-content {
  background: var(--el-fill-color-light);
  align-self: flex-start;
}
.message-content:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}
.content {
  word-wrap: break-word;
  line-height: 1.6;
}
.content.chat-markdown {
  background: transparent !important;
  color: inherit !important;
  font-size: 14px;
}
.content.chat-markdown :deep(p) {
  margin: 0 0 0.75em;
}
.content.chat-markdown :deep(p:last-child) {
  margin-bottom: 0;
}
.content.chat-markdown :deep(h1),
.content.chat-markdown :deep(h2),
.content.chat-markdown :deep(h3),
.content.chat-markdown :deep(h4) {
  margin: 0.5em 0;
  font-size: 1em;
  font-weight: 600;
}
.content.chat-markdown :deep(ul),
.content.chat-markdown :deep(ol) {
  margin: 0.5em 0;
  padding-left: 1.25em;
}
.content.chat-markdown :deep(a) {
  color: var(--el-color-primary);
}
.content :deep(.code-block-wrapper) {
  margin: 12px 0;
  border-radius: 8px;
  overflow: hidden;
  background: #1e1e1e;
}
.content :deep(.code-header) {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: #2d2d2d;
  border-bottom: 1px solid #3d3d3d;
}
.content :deep(.code-lang) {
  color: #888;
  font-size: 12px;
  text-transform: uppercase;
}
.content :deep(.code-copy-btn) {
  background: transparent;
  border: 1px solid #555;
  color: #ddd;
  padding: 4px 12px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s;
}
.content :deep(.code-copy-btn:hover) {
  background: #3d3d3d;
  border-color: #777;
}
.content :deep(.code-block-wrapper pre) {
  margin: 0;
  padding: 12px;
  background: #1e1e1e;
}
.actions-overlay {
  display: flex;
  gap: 4px;
  margin-top: 4px;
  opacity: 0;
  transition: opacity 0.2s;
}
.message-item.user .actions-overlay {
  justify-content: flex-end;
}
.message-item.assistant .actions-overlay {
  justify-content: flex-start;
}
.message-wrapper:hover .actions-overlay {
  opacity: 1;
}
</style>
