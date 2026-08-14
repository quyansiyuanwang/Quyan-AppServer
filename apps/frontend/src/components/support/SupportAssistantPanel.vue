<template>
  <section class="support-panel">
    <header class="support-panel__header">
      <strong>{{ i18ns.t('support.title') }}</strong>
      <div class="support-panel__header-actions">
        <el-button text size="small" :disabled="sending" @click="clear">
          {{ i18ns.t('support.clear') }}
        </el-button>
        <el-button plain size="small" type="primary" :disabled="sending" @click="handoff">
          {{ i18ns.t('support.handoff') }}
        </el-button>
      </div>
    </header>
    <div class="support-panel__messages">
      <p v-if="!messages.length" class="support-panel__empty">{{ i18ns.t('support.intro') }}</p>
      <article v-for="message in messages" :key="message.id" :class="message.role">
        <MarkdownRenderer v-if="message.role === 'assistant'" :content="message.content" variant="chat" />
        <template v-else>{{ message.content }}</template>
      </article>
      <div v-if="citations.length" class="support-panel__citations">
        <a
          v-for="citation in citations"
          :key="citation.slug"
          :href="citation.url"
          target="_blank"
          rel="noopener noreferrer"
          >{{ citation.title }}</a
        >
      </div>
    </div>
    <el-alert v-if="error" type="warning" :title="error" :closable="false" />
    <div class="support-panel__composer">
      <el-input
        v-model="draft"
        type="textarea"
        :rows="2"
        resize="none"
        :disabled="sending"
        @keydown.ctrl.enter.prevent="send"
      /><el-button type="primary" :loading="sending" :disabled="!draft.trim()" @click="send">{{
        i18ns.t('confirm')
      }}</el-button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessageBox } from 'element-plus'
import { i18ns } from '@/locales'
import router, { currentSiteProfile } from '@/router'
import { useRequestStore } from '@/stores/request'
import { readSseStream, SseStreamError } from '@/utils/streaming/sseStream'
import { createSupportControllerApi } from '@/client/services/support-controller.gen'
import MarkdownRenderer from '@/components/common/MarkdownRenderer.vue'

type Message = { id: string; role: 'user' | 'assistant'; content: string }
type Citation = { slug: string; title: string; url: string }
const messages = ref<Message[]>([])
const citations = ref<Citation[]>([])
const draft = ref('')
const sending = ref(false)
const error = ref('')
const api = () => createSupportControllerApi(useRequestStore().getAxios())

const responseData = (response: any) => response?.data?.data ?? response?.data ?? response

const loadConversation = async () => {
  try {
    const conversation = responseData(await api().conversation())
    const stored = Array.isArray(conversation?.messages) ? conversation.messages : []
    messages.value = stored
      .filter(
        (message: { role?: string; content?: string }) =>
          (message.role === 'user' || message.role === 'assistant') &&
          typeof message.content === 'string',
      )
      .map((message: { role: 'user' | 'assistant'; content: string }, index: number) => ({
        id: `stored-${index}`,
        role: message.role,
        content: message.content,
      }))
  } catch {
    // A transient read failure must not block a new support conversation.
  }
}

const clear = async () => {
  if (sending.value) return
  await api().clearConversation()
  messages.value = []
  citations.value = []
  error.value = ''
}

const captureVisiblePageText = () => {
  const root =
    document.querySelector<HTMLElement>('.el-main') ??
    document.querySelector<HTMLElement>('main') ??
    document.querySelector<HTMLElement>('#app')
  return (root?.innerText || root?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 16000)
}

const send = async () => {
  const content = draft.value.trim()
  if (!content || sending.value) return
  sending.value = true
  error.value = ''
  citations.value = []
  messages.value.push({ id: `u-${Date.now()}`, role: 'user', content })
  const assistant: Message = { id: `a-${Date.now()}`, role: 'assistant', content: '' }
  messages.value.push(assistant)
  draft.value = ''
  try {
    const requestStore = useRequestStore()
    const body = {
      content,
      history: messages.value.slice(0, -2).map(({ role, content }) => ({ role, content })),
      locale: String(i18ns.refer.value) === 'en' ? 'en' : 'zh-CN',
      page: {
        site: currentSiteProfile.id,
        route:
          typeof router.currentRoute.value.name === 'string' ? router.currentRoute.value.name : '',
        title: document.title,
        url: `${window.location.origin}${window.location.pathname}`,
        visibleText: captureVisiblePageText(),
      },
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const prepared = await requestStore.prepareStreamingRequest('/v1/support/messages', body)
        for await (const frame of readSseStream({
          url: prepared.url,
          init: {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...prepared.headers,
            },
            credentials: 'include',
            body: JSON.stringify(body),
          },
          decode: (data) =>
            JSON.parse(data) as { type: string; content?: string; citations?: Citation[] },
        })) {
          if (frame.type !== 'data') continue
          if (frame.value.type === 'delta') assistant.content += frame.value.content || ''
          if (frame.value.type === 'citations') citations.value = frame.value.citations || []
        }
        break
      } catch (cause) {
        if (
          cause instanceof SseStreamError &&
          cause.kind === 'http' &&
          cause.status === 401 &&
          attempt === 0
        ) {
          await requestStore.refreshStreamingSession()
          continue
        }
        throw cause
      }
    }
    if (!assistant.content) messages.value.pop()
  } catch (cause) {
    messages.value.pop()
    error.value = cause instanceof Error ? cause.message : i18ns.t('support.unavailable')
  } finally {
    sending.value = false
  }
}

const handoff = async () => {
  const { value } = await ElMessageBox.prompt(
    i18ns.t('support.handoffPrompt'),
    i18ns.t('support.handoff'),
    { inputValue: i18ns.t('support.defaultTitle') },
  ).catch(() => ({ value: '' }))
  if (!value?.trim()) return
  const description = messages.value
    .map((message) => `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.content}`)
    .join('\n\n')
  await api().handoff({
    body: { title: value.trim(), description, sourcePage: window.location.pathname },
  })
}

onMounted(() => void loadConversation())
</script>

<style scoped>
.support-panel {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto auto;
  gap: 10px;
  height: 100%;
  padding: 12px;
  box-sizing: border-box;
}
.support-panel__header,
.support-panel__header-actions,
.support-panel__composer {
  display: flex;
  align-items: center;
}
.support-panel__header {
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}
.support-panel__header-actions {
  flex: 0 0 auto;
  gap: 2px;
}
.support-panel__messages {
  min-height: 0;
  overflow: auto;
  display: grid;
  align-content: start;
  gap: 8px;
}
.support-panel article {
  max-width: 88%;
  padding: 8px 10px;
  border-radius: 6px;
  overflow-wrap: anywhere;
}
.support-panel article.user {
  justify-self: end;
  background: var(--el-color-primary-light-8);
}
.support-panel article.assistant {
  background: var(--el-fill-color-light);
}
.support-panel__empty {
  color: var(--el-text-color-secondary);
}
.support-panel__composer {
  gap: 8px;
  align-items: end;
}
.support-panel__composer .el-input {
  flex: 1;
}
.support-panel__citations {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 12px;
}
</style>
