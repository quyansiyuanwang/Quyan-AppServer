<script setup lang="ts">
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
</script>

<template>
  <section class="page-card about-shell">
    <h2 class="page-title">{{ t('about.title') }}</h2>
    <p class="page-description">{{ t('about.description') }}</p>

    <div class="content-section">
      <h3 class="section-header">{{ t('about.mission') }}</h3>
      <p>{{ t('about.missionDesc') }}</p>
    </div>

    <div class="content-section">
      <h3 class="section-header">{{ t('about.features') }}</h3>
      <div class="feature-grid">
        <article class="feature-item">
          <h4 class="feature-item-title">{{ t('about.feature1Title') }}</h4>
          <p class="muted">{{ t('about.feature1Desc') }}</p>
        </article>
        <article class="feature-item">
          <h4 class="feature-item-title">{{ t('about.feature2Title') }}</h4>
          <p class="muted">{{ t('about.feature2Desc') }}</p>
        </article>
        <article class="feature-item">
          <h4 class="feature-item-title">{{ t('about.feature3Title') }}</h4>
          <p class="muted">{{ t('about.feature3Desc') }}</p>
        </article>
      </div>
    </div>

    <div class="content-section">
      <h3 class="section-header">{{ t('about.techStack') }}</h3>
      <p>{{ t('about.techStackDesc') }}</p>
    </div>

    <div class="content-section">
      <h3 class="section-header">{{ t('about.privacy') }}</h3>
      <p>{{ t('about.privacyDesc') }}</p>
    </div>
  </section>
</template>

<style scoped>
.about-shell {
  padding: 1.5rem;
}

.content-section {
  margin-top: 2rem;
}

.content-section p {
  line-height: 1.7;
  max-width: 70ch;
}

.feature-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 1rem;
  margin-top: 1rem;
}

.feature-item {
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 1rem;
  background: rgba(255, 255, 255, 0.72);
}

.feature-item-title {
  margin: 0 0 0.5rem;
  font-family: 'JetBrains Mono', monospace;
  font-size: 1rem;
  color: var(--primary);
}

.feature-item p {
  margin: 0;
  font-size: 0.95rem;
}
</style>
