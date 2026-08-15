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
        <div
          v-if="isActiveAssistant(message)"
          class="support-panel__stream-status"
          aria-live="polite"
        >
          <el-icon class="is-loading"><Loading /></el-icon>
          <span>{{ streamStatusLabel }}</span>
        </div>
        <MarkdownRenderer
          v-if="message.role === 'assistant'"
          :content="message.content"
          variant="chat"
        />
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
    <el-collapse v-if="userFundingAvailable" class="support-panel__funding">
      <el-collapse-item :title="i18ns.t('support.userRelayFunding')" name="user-relay">
        <el-switch v-model="useUserRelay" :active-text="i18ns.t('support.useUserRelay')" />
        <div v-if="useUserRelay" class="support-panel__funding-fields">
          <el-input v-model="relayBaseUrl" :placeholder="i18ns.t('support.relayBaseUrl')" />
          <el-input v-model="relayModel" :placeholder="i18ns.t('support.relayModel')" />
          <el-input
            v-model="relayToken"
            type="password"
            show-password
            :placeholder="i18ns.t('support.relayToken')"
          />
        </div>
      </el-collapse-item>
    </el-collapse>
    <div class="support-panel__composer">
      <el-input
        v-model="draft"
        type="textarea"
        :rows="2"
        resize="none"
        :disabled="sending"
        @keydown.enter.exact.prevent="send"
      /><el-button type="primary" :loading="sending" :disabled="!draft.trim()" @click="send">{{
        i18ns.t('confirm')
      }}</el-button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessageBox } from 'element-plus'
import { Loading } from '@element-plus/icons-vue'
import { i18ns } from '@/locales'
import router, { currentSiteProfile } from '@/router'
import { useRequestStore } from '@/stores/request'
import { readSseStream, SseStreamError } from '@/utils/streaming/sseStream'
import { createSupportControllerApi } from '@/client/services/support-controller.gen'
import MarkdownRenderer from '@/components/common/MarkdownRenderer.vue'

type Message = { id: string; role: 'user' | 'assistant'; content: string }
type Citation = { slug: string; title: string; url: string }
type SupportAvailability = { allowUserBalance?: boolean; allowUserRelayToken?: boolean }
const messages = ref<Message[]>([])
const citations = ref<Citation[]>([])
const draft = ref('')
const sending = ref(false)
const error = ref('')
const streamStatus = ref<'thinking' | 'searching' | 'reading' | 'generating' | null>(null)
const userFundingAvailable = ref(false)
const useUserRelay = ref(false)
const relayBaseUrl = ref('')
const relayModel = ref('')
const relayToken = ref('')
const api = () => createSupportControllerApi(useRequestStore().getAxios())

const streamStatusLabel = computed(() => {
  if (streamStatus.value === 'thinking') return i18ns.t('support.thinking')
  if (streamStatus.value === 'searching') return i18ns.t('support.searching')
  if (streamStatus.value === 'reading') return i18ns.t('support.reading')
  return i18ns.t('support.generating')
})

const isActiveAssistant = (message: Message) =>
  Boolean(
    sending.value &&
      streamStatus.value &&
      messages.value[messages.value.length - 1]?.id === message.id &&
      message.role === 'assistant',
  )

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

const loadAvailability = async () => {
  try {
    const availability = responseData(await api().availability()) as SupportAvailability
    userFundingAvailable.value = Boolean(
      availability.allowUserBalance && availability.allowUserRelayToken,
    )
  } catch {
    userFundingAvailable.value = false
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
  if (
    useUserRelay.value &&
    (!relayBaseUrl.value.trim() || !relayModel.value.trim() || !relayToken.value.trim())
  ) {
    error.value = i18ns.t('support.userRelayIncomplete')
    return
  }
  sending.value = true
  streamStatus.value = 'searching'
  error.value = ''
  citations.value = []
  messages.value.push({ id: `u-${Date.now()}`, role: 'user', content })
  const assistantId = `a-${Date.now()}`
  messages.value.push({ id: assistantId, role: 'assistant', content: '' })
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
      ...(useUserRelay.value
        ? {
            fundingMode: 'user-relay' as const,
            relayBaseUrl: relayBaseUrl.value.trim(),
            relayModel: relayModel.value.trim(),
            relayToken: relayToken.value.trim(),
          }
        : {}),
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
            JSON.parse(data) as {
              type: string
              content?: string
              citations?: Citation[]
              stage?: 'thinking' | 'searching' | 'reading' | 'generating'
            },
        })) {
          if (frame.type !== 'data') continue
          if (frame.value.type === 'status' && frame.value.stage)
            streamStatus.value = frame.value.stage
          if (frame.value.type === 'delta') {
            streamStatus.value = 'generating'
            const assistant = messages.value.find((message) => message.id === assistantId)
            if (assistant) assistant.content += frame.value.content || ''
          }
          if (frame.value.type === 'citations') {
            citations.value = frame.value.citations || []
            streamStatus.value = 'generating'
          }
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
    if (!messages.value.find((message) => message.id === assistantId)?.content) messages.value.pop()
  } catch (cause) {
    messages.value.pop()
    error.value = cause instanceof Error ? cause.message : i18ns.t('support.unavailable')
  } finally {
    sending.value = false
    streamStatus.value = null
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

onMounted(() => {
  void loadConversation()
  void loadAvailability()
})
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
.support-panel__funding {
  border-top: 1px solid var(--el-border-color-lighter);
}
.support-panel__funding-fields {
  display: grid;
  gap: 8px;
  margin-top: 8px;
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
.support-panel__stream-status {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 18px;
  margin-bottom: 6px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 18px;
}
.support-panel__stream-status .el-icon {
  color: var(--el-color-primary);
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
