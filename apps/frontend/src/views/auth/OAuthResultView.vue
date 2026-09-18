<template>
  <main class="oauth-result-page">
    <el-card class="oauth-result-card" shadow="never">
      <el-result
        :icon="success ? 'success' : 'warning'"
        :title="i18ns.t(success ? 'oauthResult.successTitle' : 'oauthResult.failureTitle')"
        :sub-title="
          i18ns.t(success ? 'oauthResult.successDescription' : 'oauthResult.failureDescription')
        "
      >
        <template #extra>
          <p>{{ i18ns.t('oauthResult.returnToCli') }}</p>
          <p class="oauth-result-note">{{ i18ns.t('oauthResult.securityNote') }}</p>
        </template>
      </el-result>
    </el-card>
  </main>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { i18ns } from '@/locales'

const route = useRoute()
// Informational only: the CLI redirects here after saving to the OS keychain.
// This URL is not proof of authentication and cannot grant access or retry a code.
const success = computed(() => route.query.status === 'success')
</script>

<style scoped>
.oauth-result-page {
  display: grid;
  place-items: center;
  box-sizing: border-box;
  min-height: 100dvh;
  padding: 24px;
}
.oauth-result-card {
  width: min(100%, 640px);
  min-width: 0;
  border-radius: 24px;
  overflow-wrap: anywhere;
}
.oauth-result-note {
  color: var(--el-text-color-secondary);
  line-height: 1.7;
}
</style>
