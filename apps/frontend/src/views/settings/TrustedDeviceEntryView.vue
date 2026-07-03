<template>
  <div class="twofa-trusted-block twofa-trusted-entry">
    <div class="twofa-trusted-header">
      <span class="twofa-trusted-title">{{ i18ns.t('twoFactor.trustedDevicesTitle') }}</span>
      <el-button link type="primary" @click="emit('manage')">
        {{ i18ns.t('twoFactor.trustedDevicesManage') }}
      </el-button>
    </div>

    <p class="section-desc twofa-trusted-desc">
      {{ i18ns.t('twoFactor.trustedDevicesDesc') }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { i18ns } from '@/locales'

const emit = defineEmits<{
  manage: []
}>()
</script>

<style scoped>
.twofa-trusted-block {
  border: 1px solid var(--el-border-color);
  border-radius: 10px;
  padding: 12px;
  background: var(--el-fill-color-blank);
}

.twofa-trusted-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.twofa-trusted-title {
  font-weight: 600;
}

.twofa-trusted-desc {
  margin: 6px 0 0;
}
</style>
