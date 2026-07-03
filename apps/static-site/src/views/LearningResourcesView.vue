<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>

<template>
  <section class="page-card resources-shell">
    <h2 class="page-title">{{ t('learningResources.title') }}</h2>
    <p class="page-description">{{ t('learningResources.description') }}</p>

    <div class="content-section">
      <h3 class="section-header">{{ t('learningResources.methodsTitle') }}</h3>
      <p class="muted">{{ t('learningResources.methodsDesc') }}</p>
      <div class="method-grid">
        <article class="method-card">
          <h4 class="method-title">{{ t('learningResources.method1Title') }}</h4>
          <p class="muted">{{ t('learningResources.method1Desc') }}</p>
        </article>
        <article class="method-card">
          <h4 class="method-title">{{ t('learningResources.method2Title') }}</h4>
          <p class="muted">{{ t('learningResources.method2Desc') }}</p>
        </article>
        <article class="method-card">
          <h4 class="method-title">{{ t('learningResources.method3Title') }}</h4>
          <p class="muted">{{ t('learningResources.method3Desc') }}</p>
        </article>
      </div>
    </div>

    <div class="content-section">
      <h3 class="section-header">{{ t('learningResources.tipsTitle') }}</h3>
      <p class="muted">{{ t('learningResources.tipsDesc') }}</p>
      <ul class="tips-list">
        <li>{{ t('learningResources.tip1') }}</li>
        <li>{{ t('learningResources.tip2') }}</li>
        <li>{{ t('learningResources.tip3') }}</li>
        <li>{{ t('learningResources.tip4') }}</li>
        <li>{{ t('learningResources.tip5') }}</li>
      </ul>
    </div>

    <div class="content-section">
      <h3 class="section-header">{{ t('learningResources.scheduleTitle') }}</h3>
      <p class="muted">{{ t('learningResources.scheduleDesc') }}</p>
      <div class="schedule-grid">
        <article class="schedule-card">
          <h4 class="schedule-title">{{ t('learningResources.schedule1Title') }}</h4>
          <p class="muted">{{ t('learningResources.schedule1Desc') }}</p>
        </article>
        <article class="schedule-card">
          <h4 class="schedule-title">{{ t('learningResources.schedule2Title') }}</h4>
          <p class="muted">{{ t('learningResources.schedule2Desc') }}</p>
        </article>
        <article class="schedule-card">
          <h4 class="schedule-title">{{ t('learningResources.schedule3Title') }}</h4>
          <p class="muted">{{ t('learningResources.schedule3Desc') }}</p>
        </article>
      </div>
    </div>
  </section>
</template>

<style scoped>
.resources-shell {
  padding: 1.5rem;
}

.content-section {
  margin-top: 2rem;
}

.content-section p {
  line-height: 1.7;
}

.method-grid,
.schedule-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 1rem;
  margin-top: 1rem;
}

.method-card,
.schedule-card {
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 1rem;
  background: rgba(255, 255, 255, 0.82);
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease;
}

.method-card:hover,
.schedule-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 20px rgba(26, 111, 95, 0.12);
}

.method-title,
.schedule-title {
  margin: 0 0 0.5rem;
  font-family: 'JetBrains Mono', monospace;
  font-size: 1rem;
  color: var(--primary);
}

.method-card p,
.schedule-card p {
  margin: 0;
  font-size: 0.95rem;
  line-height: 1.6;
}

.tips-list {
  margin: 1rem 0 0 1.5rem;
  padding: 0;
  line-height: 1.8;
}

.tips-list li {
  margin-top: 0.5rem;
}
</style>
