<template>
  <section class="support-panel">
    <header><strong>{{ i18ns.t('support.title') }}</strong><el-button text @click="messages = []">{{ i18ns.t('support.clear') }}</el-button></header>
    <div class="support-panel__messages">
      <p v-if="!messages.length" class="support-panel__empty">{{ i18ns.t('support.intro') }}</p>
      <article v-for="message in messages" :key="message.id" :class="message.role">{{ message.content }}</article>
      <div v-if="citations.length" class="support-panel__citations"><a v-for="citation in citations" :key="citation.slug" :href="citation.url" target="_blank" rel="noopener noreferrer">{{ citation.title }}</a></div>
    </div>
    <el-alert v-if="error" type="warning" :title="error" :closable="false" />
    <div class="support-panel__composer"><el-input v-model="draft" type="textarea" :rows="2" :disabled="sending" @keydown.ctrl.enter.prevent="send" /><el-button type="primary" :loading="sending" :disabled="!draft.trim()" @click="send">{{ i18ns.t('confirm') }}</el-button></div>
    <el-button text type="primary" @click="handoff">{{ i18ns.t('support.handoff') }}</el-button>
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { ElMessageBox } from 'element-plus'
import { i18ns } from '@/locales'
import { useRequestStore, getAccessToken } from '@/stores/request'
import { readSseStream } from '@/utils/streaming/sseStream'
import { createSupportControllerApi } from '@/client/services/support-controller.gen'

type Message = { id: string; role: 'user' | 'assistant'; content: string }
type Citation = { slug: string; title: string; url: string }
const messages = ref<Message[]>([])
const citations = ref<Citation[]>([])
const draft = ref('')
const sending = ref(false)
const error = ref('')

const send = async () => {
  const content = draft.value.trim()
  if (!content || sending.value) return
  sending.value = true; error.value = ''; citations.value = []
  messages.value.push({ id: `u-${Date.now()}`, role: 'user', content })
  const assistant: Message = { id: `a-${Date.now()}`, role: 'assistant', content: '' }
  messages.value.push(assistant); draft.value = ''
  try {
    const requestStore = useRequestStore()
    const body = { content, history: messages.value.slice(0, -2).map(({ role, content }) => ({ role, content })), locale: String(i18ns.refer.value) === 'en' ? 'en' : 'zh-CN' }
    const prepared = await requestStore.prepareStreamingRequest('/v1/support/messages', body)
    const headers = new Headers(prepared.headers); const token = getAccessToken(); if (token) headers.set('Authorization', `Bearer ${token}`)
    for await (const frame of readSseStream({ url: prepared.url, init: { method: 'POST', headers, credentials: 'include', body: JSON.stringify(body) }, decode: (data) => JSON.parse(data) as { type: string; content?: string; citations?: Citation[] } })) {
      if (frame.type !== 'data') continue
      if (frame.value.type === 'delta') assistant.content += frame.value.content || ''
      if (frame.value.type === 'citations') citations.value = frame.value.citations || []
    }
    if (!assistant.content) messages.value.pop()
  } catch (cause) { messages.value.pop(); error.value = cause instanceof Error ? cause.message : i18ns.t('support.unavailable') } finally { sending.value = false }
}

const handoff = async () => {
  const { value } = await ElMessageBox.prompt(i18ns.t('support.handoffPrompt'), i18ns.t('support.handoff'), { inputValue: i18ns.t('support.defaultTitle') }).catch(() => ({ value: '' }))
  if (!value?.trim()) return
  const description = messages.value.map((message) => `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.content}`).join('\n\n')
  await createSupportControllerApi(useRequestStore().getAxios()).handoff({
    body: { title: value.trim(), description, sourcePage: window.location.pathname },
  })
}
</script>

<style scoped>
.support-panel{display:grid;grid-template-rows:auto 1fr auto auto;gap:10px;height:100%;padding:12px;box-sizing:border-box}.support-panel header{display:flex;justify-content:space-between;align-items:center}.support-panel__messages{min-height:0;overflow:auto;display:grid;align-content:start;gap:8px}.support-panel article{max-width:88%;padding:8px 10px;border-radius:6px;white-space:pre-wrap}.support-panel article.user{justify-self:end;background:var(--el-color-primary-light-8)}.support-panel article.assistant{background:var(--el-fill-color-light)}.support-panel__empty{color:var(--el-text-color-secondary)}.support-panel__composer{display:flex;gap:8px;align-items:end}.support-panel__composer .el-input{flex:1}.support-panel__citations{display:flex;gap:8px;flex-wrap:wrap;font-size:12px}
</style>
