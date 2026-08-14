<template>
  <main class="not-found-page">
    <section class="not-found-panel" aria-labelledby="not-found-title">
      <p class="not-found-code" aria-hidden="true">404</p>
      <h1 id="not-found-title">{{ i18ns.t('notFound.title') }}</h1>
      <p class="not-found-description">
        {{
          isRejectedHost
            ? i18ns.t('notFound.unknownHostDescription', { host: currentSiteProfile.hostname })
            : i18ns.t('notFound.description')
        }}
      </p>
      <div class="not-found-actions">
        <el-button type="primary" @click="goHome">
          <el-icon><House /></el-icon>
          {{ i18ns.t('notFound.goHome') }}
        </el-button>
        <el-button @click="goBack">
          <el-icon><ArrowLeft /></el-icon>
          {{ i18ns.t('notFound.goBack') }}
        </el-button>
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { ArrowLeft, House } from '@element-plus/icons-vue'
import { currentSiteProfile, router } from '@/router'
import { getPublicSiteProfile, isKnownSiteProfile } from '@/config/site-registry'
import { i18ns } from '@/locales'
import { assignDocument } from '@/service/navigationService'

const isRejectedHost = computed(() => !isKnownSiteProfile(currentSiteProfile))

const goHome = () => {
  const publicSite = getPublicSiteProfile(window.location.hostname)
  assignDocument(new URL('/home', publicSite.canonicalOrigin).toString())
}

const goBack = () => {
  if (window.history.length > 1) {
    router.back()
    return
  }
  goHome()
}
</script>

<style scoped>
.not-found-page {
  box-sizing: border-box;
  display: grid;
  min-height: 100vh;
  place-items: center;
  padding: 24px;
  background: var(--color-background);
}

.not-found-panel {
  width: min(100%, 560px);
  padding: 40px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  background: var(--el-bg-color);
  box-shadow: var(--el-box-shadow-light);
  text-align: center;
}

.not-found-code {
  margin: 0;
  color: var(--el-color-primary);
  font-size: 64px;
  font-weight: 700;
  line-height: 1;
}

h1 {
  margin: 20px 0 0;
  color: var(--el-text-color-primary);
  font-size: 24px;
  font-weight: 600;
}

.not-found-description {
  margin: 12px auto 0;
  color: var(--el-text-color-regular);
  line-height: 1.7;
  overflow-wrap: anywhere;
}

.not-found-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
  margin-top: 28px;
}

@media (max-width: 480px) {
  .not-found-page {
    padding: 16px;
  }

  .not-found-panel {
    padding: 32px 24px;
  }

  .not-found-actions :deep(.el-button) {
    width: 100%;
  }
}
</style>
