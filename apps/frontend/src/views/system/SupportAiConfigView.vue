<template>
  <main class="support-ai-config" v-loading="loading">
    <header class="support-ai-config__header">
      <div>
        <h2>{{ i18ns.t('nav.supportAiConfig') }}</h2>
        <p>{{ i18ns.t('support.configDescription') }}</p>
      </div>
      <el-tag :type="form.enabled && form.apiKeyConfigured ? 'success' : 'info'">{{
        form.enabled && form.apiKeyConfigured
          ? i18ns.t('support.configEnabled')
          : i18ns.t('support.configDisabled')
      }}</el-tag>
    </header>
    <el-form label-position="top" class="support-ai-config__form">
      <el-form-item :label="i18ns.t('support.enabled')"
        ><el-switch v-model="form.enabled"
      /></el-form-item>
      <el-form-item :label="i18ns.t('support.upstreamUrl')"
        ><el-input v-model="form.upstreamUrl" placeholder="https://api.example.com/v1"
      /></el-form-item>
      <el-form-item :label="i18ns.t('support.model')"
        ><el-input v-model="form.model"
      /></el-form-item>
      <el-form-item :label="i18ns.t('support.requestFormat')"
        ><el-select v-model="form.requestFormat"
          ><el-option value="openai-chat-completions" label="OpenAI" /><el-option
            value="anthropic"
            label="Anthropic" /><el-option value="gemini" label="Gemini" /></el-select
      ></el-form-item>
      <el-form-item :label="i18ns.t('support.apiKey')"
        ><el-input
          v-model="apiKey"
          show-password
          type="password"
          :placeholder="form.apiKeyConfigured ? i18ns.t('support.apiKeyConfigured') : ''"
        /><el-checkbox v-model="clearApiKey">{{
          i18ns.t('support.clearApiKey')
        }}</el-checkbox></el-form-item
      >
      <el-form-item :label="i18ns.t('support.systemPrompt')"
        ><el-input v-model="form.systemPrompt" type="textarea" :rows="5"
      /></el-form-item>
      <div class="support-ai-config__limits">
        <el-form-item :label="i18ns.t('support.maxRequests')"
          ><el-input-number v-model="form.maxRequests" :min="1" /></el-form-item
        ><el-form-item :label="i18ns.t('support.windowSeconds')"
          ><el-input-number v-model="form.windowSeconds" :min="10"
        /></el-form-item>
        <el-form-item :label="i18ns.t('support.maxAgentRounds')"
          ><el-input-number v-model="form.maxAgentRounds" :min="1" :max="8"
        /></el-form-item>
        <el-form-item :label="i18ns.t('support.maxOutputTokens')"
          ><el-input-number v-model="form.maxOutputTokens" :min="128" :max="8192" :step="128"
        /></el-form-item>
        <el-form-item :label="i18ns.t('support.sessionRetentionDays')"
          ><el-input-number v-model="form.sessionRetentionDays" :min="1" :max="7"
        /></el-form-item>
        <el-form-item :label="i18ns.t('support.inputPricePerMillion')"
          ><el-input-number v-model="form.inputPricePerMillion" :min="0" :precision="6"
        /></el-form-item>
        <el-form-item :label="i18ns.t('support.outputPricePerMillion')"
          ><el-input-number v-model="form.outputPricePerMillion" :min="0" :precision="6"
        /></el-form-item>
      </div>
      <el-form-item :label="i18ns.t('support.userFunding')">
        <el-space direction="vertical" alignment="start">
          <el-checkbox v-model="form.allowUserBalance">{{
            i18ns.t('support.allowUserBalance')
          }}</el-checkbox>
          <el-checkbox v-model="form.allowUserRelayToken">{{
            i18ns.t('support.allowUserRelayToken')
          }}</el-checkbox>
        </el-space>
      </el-form-item>
      <el-button type="primary" :loading="saving" @click="save">{{ i18ns.t('save') }}</el-button>
    </el-form>
  </main>
</template>
<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { i18ns } from '@/locales'
import { supportService } from '@/service/supportService'
import type { SupportAiConfigDto } from '@/client/types.gen'
const loading = ref(false)
const saving = ref(false)
const apiKey = ref('')
const clearApiKey = ref(false)
const form = reactive<SupportAiConfigDto>({
  enabled: false,
  upstreamUrl: '',
  apiKeyConfigured: false,
  model: '',
  requestFormat: 'openai-chat-completions',
  systemPrompt: '',
  maxRequests: 20,
  windowSeconds: 600,
  maxAgentRounds: 3,
  maxOutputTokens: 2048,
  allowUserBalance: false,
  allowUserRelayToken: false,
  sessionRetentionDays: 3,
  inputPricePerMillion: 0,
  outputPricePerMillion: 0,
})
const api = () => supportService.getApi()
const load = async () => {
  loading.value = true
  try {
    const result: any = await api().getConfig()
    Object.assign(form, result.data?.data ?? result.data)
  } finally {
    loading.value = false
  }
}
const save = async () => {
  saving.value = true
  try {
    const result: any = await api().updateConfig({
      body: {
        enabled: form.enabled,
        upstreamUrl: form.upstreamUrl,
        model: form.model,
        requestFormat: form.requestFormat,
        systemPrompt: form.systemPrompt,
        maxRequests: form.maxRequests,
        windowSeconds: form.windowSeconds,
        maxAgentRounds: form.maxAgentRounds,
        maxOutputTokens: form.maxOutputTokens,
        allowUserBalance: form.allowUserBalance,
        allowUserRelayToken: form.allowUserRelayToken,
        sessionRetentionDays: form.sessionRetentionDays,
        inputPricePerMillion: form.inputPricePerMillion,
        outputPricePerMillion: form.outputPricePerMillion,
        apiKey: apiKey.value || undefined,
        clearApiKey: clearApiKey.value,
      },
    })
    Object.assign(form, result.data?.data ?? result.data)
    apiKey.value = ''
    clearApiKey.value = false
    ElMessage.success(i18ns.t('success'))
  } finally {
    saving.value = false
  }
}
onMounted(() => void load())
</script>
<style scoped>
.support-ai-config {
  max-width: 860px;
  margin: 0 auto;
}
.support-ai-config__header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}
.support-ai-config__header h2 {
  margin: 0;
  font-size: 20px;
}
.support-ai-config__header p {
  color: var(--el-text-color-secondary);
  margin: 6px 0 0;
}
.support-ai-config__form {
  max-width: 680px;
}
.support-ai-config__limits {
  display: flex;
  gap: 16px;
}
.support-ai-config__limits .el-form-item {
  flex: 1;
}
</style>
