<template>
  <section class="api-test-card">
    <div class="toolbar">
      <div>
        <h2>{{ title }}</h2>
        <p>{{ description }}</p>
      </div>
    </div>
    <el-form label-position="top">
      <el-form-item :label="t('productResources.testApiKey')">
        <el-input v-model="apiKey" type="password" show-password autocomplete="off" />
        <p class="field-hint">{{ t('productResources.testApiKeyHint') }}</p>
      </el-form-item>
      <slot />
    </el-form>
    <el-alert v-if="error" type="error" :title="error" :closable="false" />
    <div class="test-actions"><slot name="actions" /></div>
    <div v-if="result !== undefined" class="result">
      <h3>{{ t('productResources.testResult') }}</h3>
      <pre>{{ formattedResult }}</pre>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { i18ns } from '@/locales'

const apiKey = defineModel<string>('apiKey', { default: '' })
const props = defineProps<{
  title: string
  description: string
  error?: string
  result?: unknown
}>()
const { t } = i18ns
const formattedResult = computed(() => JSON.stringify(props.result, null, 2))
</script>

<style scoped>
.api-test-card {
  margin-top: 24px;
  padding-top: 24px;
  border-top: 1px solid var(--el-border-color-light);
}
.toolbar {
  margin-bottom: 16px;
}
.toolbar h2,
.result h3 {
  margin: 0 0 6px;
  font-size: 17px;
}
.toolbar p,
.field-hint {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.5;
}
.field-hint {
  margin-top: 6px;
}
.test-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.result {
  margin-top: 16px;
}
.result pre {
  max-height: 280px;
  margin: 0;
  overflow: auto;
  padding: 12px;
  border: 1px solid var(--el-border-color-light);
  background: var(--el-fill-color-lighter);
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
