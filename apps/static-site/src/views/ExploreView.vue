<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const exploreItems = [
  { route: '/', label: 'nav.home', desc: 'explore.homeDesc' },
  { route: '/learning', label: 'nav.learning', desc: 'explore.learningDesc' },
  { route: '/games', label: 'nav.games', desc: 'explore.gamesDesc' },
  { route: '/about', label: 'about.title', desc: 'explore.aboutDesc' },
  { route: '/faq', label: 'faq.title', desc: 'explore.faqDesc' },
  { route: '/updates', label: 'updates.title', desc: 'explore.updatesDesc' },
  { route: '/learning/resources', label: 'learningResources.title', desc: 'explore.resourcesDesc' },
  { route: '/games/guide', label: 'gamesGuide.title', desc: 'explore.guideDesc' },
]
</script>

<template>
  <section class="page-card explore-shell">
    <h2 class="page-title">{{ t('explore.title') }}</h2>
    <p class="page-description">{{ t('explore.description') }}</p>

    <div class="content-section">
      <h3 class="section-header">{{ t('explore.quickStart') }}</h3>
      <p class="muted">{{ t('explore.quickStartDesc') }}</p>
      <ol class="step-list">
        <li>{{ t('explore.step1') }}</li>
        <li>{{ t('explore.step2') }}</li>
        <li>{{ t('explore.step3') }}</li>
      </ol>
    </div>

    <div class="content-section">
      <h3 class="section-header">{{ t('explore.learningPaths') }}</h3>
      <p class="muted">{{ t('explore.learningPathsDesc') }}</p>
      <div class="path-grid">
        <article class="path-card">
          <h4 class="path-title">{{ t('explore.beginnerPath') }}</h4>
          <p class="muted">{{ t('explore.beginnerPathDesc') }}</p>
        </article>
        <article class="path-card">
          <h4 class="path-title">{{ t('explore.intermediatePath') }}</h4>
          <p class="muted">{{ t('explore.intermediatePathDesc') }}</p>
        </article>
        <article class="path-card">
          <h4 class="path-title">{{ t('explore.advancedPath') }}</h4>
          <p class="muted">{{ t('explore.advancedPathDesc') }}</p>
        </article>
      </div>
    </div>

    <div class="content-section">
      <h3 class="section-header">{{ t('explore.navigationTips') }}</h3>
      <p class="muted">{{ t('explore.navigationTipsDesc') }}</p>
      <ul class="tip-list">
        <li>{{ t('explore.tip1') }}</li>
        <li>{{ t('explore.tip2') }}</li>
        <li>{{ t('explore.tip3') }}</li>
      </ul>
    </div>

    <div class="content-section">
      <h3 class="section-header">{{ t('nav.home') }}</h3>
      <div class="explore-grid">
        <RouterLink
          v-for="item in exploreItems"
          :key="item.route"
          :to="item.route"
          class="explore-card"
        >
          <h4>{{ t(item.label) }}</h4>
          <p class="muted">{{ t(item.desc) }}</p>
        </RouterLink>
      </div>
    </div>
  </section>
</template>

<style scoped>
.explore-shell {
  padding: 1.5rem;
}

.content-section {
  margin-top: 2rem;
}

.step-list,
.tip-list {
  margin: 1rem 0 0 1.5rem;
  padding: 0;
  line-height: 1.8;
}

.step-list li,
.tip-list li {
  margin-top: 0.5rem;
}

.path-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 1rem;
  margin-top: 1rem;
}

.path-card {
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 1rem;
  background: rgba(255, 255, 255, 0.72);
}

.path-title {
  margin: 0 0 0.5rem;
  font-family: 'JetBrains Mono', monospace;
  font-size: 1rem;
  color: var(--primary);
}

.path-card p {
  margin: 0;
  font-size: 0.95rem;
}

.explore-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 0.9rem;
  margin-top: 1rem;
}

.explore-card {
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 1rem;
  background: rgba(255, 255, 255, 0.82);
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease;
}

.explore-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 20px rgba(26, 111, 95, 0.12);
}

.explore-card h4 {
  margin: 0 0 0.5rem;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.95rem;
  color: var(--primary);
}

.explore-card p {
  margin: 0;
  font-size: 0.9rem;
}
</style>
