<template>
  <section class="sm-security-panel" role="note" :aria-label="i18ns.t('warning')">
    <div class="sm-security-title">⚠ {{ i18ns.t('scriptManager.securityTitle') }}</div>
    <ul class="sm-security-list">
      <li v-for="item in items" :key="item">{{ item }}</li>
    </ul>
    <div class="sm-security-ack">
      <el-checkbox
        :model-value="modelValue"
        @update:model-value="emit('update:modelValue', Boolean($event))"
      >
        {{ i18ns.t('scriptManager.acknowledgeLabel') }}
      </el-checkbox>
      <div class="sm-security-ack-hint">
        {{ i18ns.t('scriptManager.acknowledgeHint') }}
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { i18ns } from '@/locales'

defineProps<{
  modelValue: boolean
  items: string[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()
</script>

<style scoped>
.sm-security-panel {
  margin: 12px 16px 0;
  padding: 12px 14px;
  border: 1px solid rgba(248, 81, 73, 0.5);
  border-radius: 8px;
  background: linear-gradient(180deg, rgba(248, 81, 73, 0.14), rgba(248, 81, 73, 0.08));
  box-shadow: inset 0 0 0 1px rgba(248, 81, 73, 0.08);
}

.sm-security-title {
  font-size: 14px;
  font-weight: 700;
  color: #f85149;
  letter-spacing: 0.04em;
}

.sm-security-list {
  margin: 8px 0 0;
  padding-left: 18px;
  display: grid;
  gap: 6px;
  color: var(--el-text-color-regular);
  font-size: 12px;
  line-height: 1.5;
}

.sm-security-list li::marker {
  color: #f85149;
}

.sm-security-ack {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed rgba(248, 81, 73, 0.4);
}

.sm-security-ack-hint {
  margin-top: 6px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.5;
}

:deep(.sm-security-ack .el-checkbox) {
  align-items: flex-start;
}

:deep(.sm-security-ack .el-checkbox__label) {
  white-space: normal;
  line-height: 1.6;
  color: var(--el-text-color-primary);
}
</style>
