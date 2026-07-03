<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { RouterLink, RouterView } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { setI18nLocale, type AppLocale } from '@/locales'
import { useLearningProgressStore } from '@/stores/learningProgress'

const { t } = useI18n()
const progressStore = useLearningProgressStore()

const localeModel = computed<AppLocale>({
  get: () => progressStore.state.preferences.locale,
  set: (locale) => {
    progressStore.setLocale(locale)
    setI18nLocale(locale)
  },
})

const resetProgress = (): void => {
  if (!window.confirm('Reset all local progress data?')) return
  progressStore.resetProgress()
}

onMounted(() => {
  setI18nLocale(progressStore.state.preferences.locale)
})
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <div class="brand-block">
        <span class="brand-chip">playful editorial static mirror</span>
        <h1 class="brand-title">{{ t('app.title') }}</h1>
        <p class="brand-subtitle">{{ t('app.subtitle') }}</p>
      </div>

      <div class="toolbar">
        <label for="locale" class="muted">{{ t('app.localeLabel') }}</label>
        <select id="locale" v-model="localeModel" class="select">
          <option value="zh-CN">中文</option>
          <option value="en">English</option>
        </select>
        <button class="button ghost" type="button" @click="resetProgress">
          {{ t('app.resetProgress') }}
        </button>
      </div>
    </header>

    <nav class="top-nav">
      <RouterLink class="nav-link" to="/">{{ t('nav.home') }}</RouterLink>
      <RouterLink class="nav-link" to="/learning">{{ t('nav.learning') }}</RouterLink>
      <RouterLink class="nav-link" to="/games">{{ t('nav.games') }}</RouterLink>
    </nav>

    <RouterView />

    <footer class="site-footer">
      <div class="quicklink-panel">
        <RouterLink class="button mini" to="/onboarding">{{ t('onboarding.title') }}</RouterLink>
        <RouterLink class="button mini" to="/explore">{{ t('explore.title') }}</RouterLink>
        <RouterLink class="button mini" to="/feedback">{{ t('feedback.title') }}</RouterLink>
        <RouterLink class="button mini" to="/about">{{ t('about.title') }}</RouterLink>
        <RouterLink class="button mini" to="/faq">{{ t('faq.title') }}</RouterLink>
        <RouterLink class="button mini" to="/updates">{{ t('updates.title') }}</RouterLink>
      </div>
      <div
        class="footer-meta muted"
        style="margin-top: 1.2rem; text-align: center; font-size: 0.98rem"
      >
        &copy; 2026 {{ t('app.title') }} · <RouterLink to="/">Home</RouterLink> ·
        <RouterLink to="/explore">Explore</RouterLink>
      </div>
    </footer>
  </div>
</template>
<style scoped>
.brand-block {
  display: grid;
  gap: 0.28rem;
}

.brand-chip {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  padding: 0.22rem 0.7rem;
  border-radius: 999px;
  background: rgba(255, 248, 233, 0.88);
  border: 1px dashed rgba(212, 87, 43, 0.5);
  color: var(--accent);
  font-size: 0.74rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  font-weight: 700;
}

.site-footer {
  margin-top: 2.5rem;
  padding-bottom: 1.5rem;
}
.quicklink-panel {
  justify-content: center;
}
.button.mini {
  padding: 0.35rem 0.9rem;
  font-size: 0.98rem;
}
</style>
