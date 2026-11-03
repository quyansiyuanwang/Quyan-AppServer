<template>
  <div class="header-forwarding">
    <div class="header-forwarding-mode">
      <span>{{ i18ns.t('relay.forwardAllRequestHeaders') }}</span>
      <el-switch
        v-model="forwardAll"
        :aria-label="i18ns.t('relay.forwardAllRequestHeaders')"
        data-testid="forward-all-request-headers"
      />
    </div>
    <p class="header-forwarding-help">{{ i18ns.t('relay.forwardAllRequestHeadersHelp') }}</p>

    <div>
      <div class="header-forwarding-label">{{ i18ns.t('relay.forwardedRequestHeaders') }}</div>
      <el-select
        v-model="extraHeaders"
        multiple
        filterable
        allow-create
        default-first-option
        :disabled="forwardAll"
        :multiple-limit="RELAY_FORWARDED_HEADER_LIMITS.maxNames"
        :reserve-keyword="false"
        :aria-label="i18ns.t('relay.forwardedRequestHeaders')"
        :placeholder="i18ns.t('relay.forwardedRequestHeadersPlaceholder')"
        class="w-full"
      />
      <p class="header-forwarding-help">{{ i18ns.t('relay.forwardedRequestHeadersHelp') }}</p>
    </div>

    <details open class="header-forwarding-defaults">
      <summary>{{ i18ns.t('relay.defaultForwardedHeaders') }}</summary>
      <table>
        <thead>
          <tr>
            <th scope="col">{{ i18ns.t('relay.defaultForwardedHeadersScope') }}</th>
            <th scope="col">{{ i18ns.t('relay.defaultForwardedHeadersNames') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="group in defaultHeaderGroups" :key="group.scope">
            <th scope="row">{{ group.scope }}</th>
            <td>
              <code v-for="name in group.names" :key="name">{{ name }}</code>
            </td>
          </tr>
        </tbody>
      </table>
    </details>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { RELAY_DEFAULT_FORWARDED_HEADERS, RELAY_FORWARDED_HEADER_LIMITS } from '@quyan/shared'
import { i18ns } from '@/locales'

const extraHeaders = defineModel<string[]>('extraHeaders', { required: true })
const forwardAll = defineModel<boolean>('forwardAll', { required: true })
const defaultHeaderGroups = computed(() => [
  {
    scope: i18ns.t('relay.defaultForwardedHeadersCommon'),
    names: RELAY_DEFAULT_FORWARDED_HEADERS.common,
  },
  { scope: 'OpenAI', names: RELAY_DEFAULT_FORWARDED_HEADERS.openai },
  { scope: 'Anthropic', names: RELAY_DEFAULT_FORWARDED_HEADERS.anthropic },
  { scope: 'Gemini', names: RELAY_DEFAULT_FORWARDED_HEADERS.gemini },
])
</script>

<style scoped>
.header-forwarding {
  display: grid;
  gap: 12px;
  width: 100%;
  min-width: 0;
}

.header-forwarding-mode {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.header-forwarding-mode :deep(.el-switch) {
  flex-shrink: 0;
}

.header-forwarding-help {
  margin: 4px 0 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.6;
}

.header-forwarding-label {
  margin-bottom: 4px;
}

.header-forwarding-defaults {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--el-border-radius-base);
}

summary {
  padding: 10px 12px;
  cursor: pointer;
  line-height: 1.5;
}

summary:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}

table {
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
  font-size: 12px;
  line-height: 1.6;
}

th,
td {
  padding: 8px 10px;
  border-top: 1px solid var(--el-border-color-lighter);
  text-align: left;
  vertical-align: top;
}

th:first-child {
  width: 92px;
  overflow-wrap: anywhere;
}

td code {
  display: inline-block;
  max-width: 100%;
  margin: 0 6px 4px 0;
  padding: 1px 4px;
  border-radius: 3px;
  background: var(--el-fill-color-light);
  overflow-wrap: anywhere;
}
</style>
