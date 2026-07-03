<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useLearningProgressStore } from '@/stores/learningProgress'
import { BookOpen, Brain, BookMarked, ArrowRight } from 'lucide-vue-next'

const { t } = useI18n()
const progressStore = useLearningProgressStore()

const masteredCount = computed(() => progressStore.masteredCount)
const wrongNotebookCount = computed(() => progressStore.wrongNotebookCount)
const practiceAccuracy = computed(() => progressStore.practiceAccuracy)
</script>

<template>
  <section class="page-card section-alt2 hub-shell">
    <div class="hub-hero">
      <div>
        <p class="feature-kicker">learning zone</p>
        <h2 class="page-title">{{ t('learningHub.title') }}</h2>
        <p class="page-description">{{ t('learningHub.description') }}</p>
      </div>
      <div class="grid cards-3 stat-cluster">
        <div class="stat">
          <p class="stat-label">{{ t('home.statMastered') }}</p>
          <p class="stat-value">{{ masteredCount }}</p>
        </div>
        <div class="stat">
          <p class="stat-label">{{ t('vocabulary.wrongNotebookCount') }}</p>
          <p class="stat-value">{{ wrongNotebookCount }}</p>
        </div>
        <div class="stat">
          <p class="stat-label">{{ t('vocabulary.practiceAccuracy') }}</p>
          <p class="stat-value">{{ practiceAccuracy }}%</p>
        </div>
      </div>
    </div>

    <div class="hub-grid section-space">
      <article class="feature-card route-card">
        <p class="feature-kicker">{{ t('learningHub.vocabularyKicker') }}</p>
        <h3 class="feature-title">
          <BookOpen
            :size="20"
            style="display: inline; vertical-align: middle; margin-right: 0.4rem"
          />
          {{ t('vocabulary.title') }}
        </h3>
        <p class="muted">{{ t('learningHub.vocabularyDesc') }}</p>
        <div class="route-card-footer">
          <span class="badge">Core collection</span>
          <RouterLink to="/learning/vocabulary" class="button primary">
            {{ t('learningHub.enterVocabulary') }}
            <ArrowRight :size="16" />
          </RouterLink>
        </div>
      </article>

      <article class="feature-card route-card">
        <p class="feature-kicker">{{ t('learningHub.practiceKicker') }}</p>
        <h3 class="feature-title">
          <Brain :size="20" style="display: inline; vertical-align: middle; margin-right: 0.4rem" />
          {{ t('vocabulary.modePractice') }}
        </h3>
        <p class="muted">{{ t('learningHub.practiceDesc') }}</p>
        <div class="route-card-footer">
          <span class="badge">Challenge mode</span>
          <RouterLink to="/learning/vocabulary?mode=practice" class="button">
            {{ t('learningHub.enterPractice') }}
            <ArrowRight :size="16" />
          </RouterLink>
        </div>
      </article>

      <article class="feature-card route-card">
        <p class="feature-kicker">{{ t('learningResources.kicker') }}</p>
        <h3 class="feature-title">
          <BookMarked
            :size="20"
            style="display: inline; vertical-align: middle; margin-right: 0.4rem"
          />
          {{ t('learningResources.title') }}
        </h3>
        <p class="muted">{{ t('learningResources.description') }}</p>
        <div class="route-card-footer">
          <span class="badge">Reference shelf</span>
          <RouterLink to="/learning/resources" class="button">
            {{ t('learningResources.cta') }}
            <ArrowRight :size="16" />
          </RouterLink>
        </div>
      </article>
    </div>

    <section class="section-space split-band">
      <div>
        <h3 class="section-header">Suggested flow</h3>
        <p class="muted">
          先浏览词库，再用练习模式重复强化，最后把高频易错项沉淀进错题本，形成稳定的轻学习循环。
        </p>
      </div>
      <div class="quicklink-panel compact-panel">
        <RouterLink class="button mini" to="/onboarding">{{ t('onboarding.title') }}</RouterLink>
        <RouterLink class="button mini" to="/explore">{{ t('explore.title') }}</RouterLink>
      </div>
    </section>
  </section>
</template>

<style scoped>
.hub-shell {
  padding: 1.5rem;
}

.hub-hero {
  display: grid;
  gap: 1rem;
}

.stat-cluster {
  margin-top: 0.3rem;
}

.route-card {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  min-height: 220px;
}

.route-card-footer {
  display: flex;
  justify-content: space-between;
  gap: 0.8rem;
  align-items: center;
  margin-top: 1rem;
  flex-wrap: wrap;
}

.split-band {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: center;
  border-radius: 18px;
  padding: 1rem 1.1rem;
  background: rgba(255, 255, 255, 0.62);
  border: 1px solid var(--section-border);
}

.compact-panel {
  justify-content: flex-end;
}

@media (max-width: 920px) {
  .split-band {
    flex-direction: column;
    align-items: flex-start;
  }

  .compact-panel {
    justify-content: flex-start;
  }
}
</style>
