<template>
  <fieldset :disabled="disabled" class="system-header-policy">
    <legend>{{ i18ns.t('relay.systemRequestHeaderPolicy') }}</legend>
    <p>{{ i18ns.t('relay.systemRequestHeaderPolicyHelp') }}</p>
    <el-form :disabled="disabled" label-position="top">
      <RelayForwardedHeadersEditor
        v-model:mode="mode"
        v-model:extra-headers="policy.allowlist"
        v-model:blocked-headers="policy.blocklist"
      />
    </el-form>
  </fieldset>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { RelayChannelRequestHeaderMode, RelayRequestHeaderPolicy } from '@quyan/shared'
import { i18ns } from '@/locales'
import RelayForwardedHeadersEditor from './RelayForwardedHeadersEditor.vue'

const policy = defineModel<RelayRequestHeaderPolicy>({ required: true })
defineProps<{ disabled: boolean }>()
const mode = computed<RelayChannelRequestHeaderMode>({
  get: () => policy.value.mode,
  set: (value) => {
    if (value !== 'inherit') policy.value.mode = value
  },
})
</script>

<style scoped>
.system-header-policy {
  min-width: 0;
  margin: 16px 0;
  padding: 16px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 12px;
}
legend {
  font-weight: 600;
}
p {
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 1.6;
  margin: 0 0 12px;
}
</style>
