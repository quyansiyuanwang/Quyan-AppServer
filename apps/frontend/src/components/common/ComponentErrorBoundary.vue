<template>
  <div v-if="hasError" class="error-boundary-fallback">
    <el-alert
      type="error"
      show-icon
      :closable="false"
      title="Component failed to render"
      description="An unexpected error occurred while rendering this section."
    />
    <el-button type="primary" size="small" @click="resetBoundary">
      {{ i18ns.t('refresh') }}
    </el-button>
  </div>
  <div v-else :key="boundaryKey">
    <slot />
  </div>
</template>

<script setup lang="ts">
import { onErrorCaptured, ref } from 'vue'
import { i18ns } from '@/locales'
import { reportClientError } from '@/service/errorReportService'

const hasError = ref(false)
const boundaryKey = ref(0)

const resetBoundary = () => {
  hasError.value = false
  boundaryKey.value += 1
}

onErrorCaptured((error, _instance, info) => {
  console.error('ComponentErrorBoundary captured an error', {
    error,
    info,
  })
  void reportClientError({
    errorType: error instanceof Error ? error.name : 'VueRenderError',
    message: error instanceof Error ? error.message : String(error),
    route: window.location.pathname,
    severity: 'error',
    stack: error instanceof Error ? error.stack : undefined,
    context: { vueInfo: info },
  })
  hasError.value = true
  return false
})
</script>

<style scoped>
.error-boundary-fallback {
  display: grid;
  gap: 12px;
  margin-top: 8px;
}
</style>
