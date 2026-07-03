<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const updates = [
  { version: 'v2026_04_20', desc: 'v2026_04_20_desc' },
  { version: 'v2026_04_15', desc: 'v2026_04_15_desc' },
]

const roadmapItems = [
  { title: 'planned1', desc: 'planned1Desc' },
  { title: 'planned2', desc: 'planned2Desc' },
  { title: 'planned3', desc: 'planned3Desc' },
]
</script>

<template>
  <section class="page-card updates-shell">
    <h2 class="page-title">{{ t('updates.title') }}</h2>
    <p class="page-description">{{ t('updates.description') }}</p>

    <div class="content-section">
      <h3 class="section-header">{{ t('updates.roadmap') }}</h3>
      <p class="muted">{{ t('updates.roadmapDesc') }}</p>
      <div class="roadmap-grid">
        <article v-for="item in roadmapItems" :key="item.title" class="roadmap-card">
          <h4 class="roadmap-title">{{ t(`updates.${item.title}`) }}</h4>
          <p class="muted">{{ t(`updates.${item.desc}`) }}</p>
        </article>
      </div>
    </div>

    <div class="content-section">
      <h3 class="section-header">{{ t('updates.title') }}</h3>
      <div class="updates-list">
        <article v-for="update in updates" :key="update.version" class="update-card">
          <h4 class="update-version">{{ t(`updates.${update.version}`) }}</h4>
          <p class="muted">{{ t(`updates.${update.desc}`) }}</p>
        </article>
      </div>
    </div>
  </section>
</template>

<style scoped>
.updates-shell {
  padding: 1.5rem;
}

.content-section {
  margin-top: 2rem;
}

.roadmap-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 1rem;
  margin-top: 1rem;
}

.roadmap-card {
  border: 1px dashed var(--accent);
  border-radius: 14px;
  padding: 1rem;
  background: rgba(255, 248, 233, 0.7);
}

.roadmap-title {
  margin: 0 0 0.5rem;
  font-family: 'JetBrains Mono', monospace;
  font-size: 1rem;
  color: var(--accent);
}

.roadmap-card p {
  margin: 0;
  font-size: 0.95rem;
}

.updates-list {
  display: grid;
  gap: 1rem;
  margin-top: 1rem;
}

.update-card {
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 1.2rem;
  background: rgba(255, 255, 255, 0.82);
  border-left: 4px solid var(--primary);
}

.update-version {
  margin: 0 0 0.5rem;
  font-family: 'JetBrains Mono', monospace;
  font-size: 1.05rem;
  color: var(--primary);
}

.update-card p {
  margin: 0;
  line-height: 1.6;
}
</style>
