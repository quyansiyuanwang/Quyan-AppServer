<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useLearningProgressStore } from '@/stores/learningProgress'
import { BookOpen, Brain, Gamepad2, ArrowRight, Trophy, Target, TrendingUp } from 'lucide-vue-next'

const { t } = useI18n()
const progressStore = useLearningProgressStore()

const masteredCount = computed(() => progressStore.masteredCount)
const wrongNotebookCount = computed(() => progressStore.wrongNotebookCount)
const practiceAccuracy = computed(() => progressStore.practiceAccuracy)
const bestMoves = computed(() => progressStore.state.game.bestMoves)
const reactionBest = computed(() => progressStore.state.game.reactionBestMs)
const guessBest = computed(() => progressStore.state.game.guessBestAttempts)

const featureLinks = [
  { to: '/about', title: 'about.title', desc: 'about.description' },
  { to: '/updates', title: 'updates.title', desc: 'updates.description' },
  {
    to: '/learning/resources',
    title: 'learningResources.title',
    desc: 'learningResources.description',
  },
  { to: '/games/guide', title: 'gamesGuide.title', desc: 'gamesGuide.description' },
  { to: '/onboarding', title: 'onboarding.title', desc: 'onboarding.description' },
  { to: '/explore', title: 'explore.title', desc: 'explore.description' },
]
</script>

<template>
  <section class="page-card home-shell section-alt1">
    <div class="hero-grid">
      <div class="hero-copy">
        <p class="eyebrow">qysyw static playground</p>
        <h2 class="page-title hero-title">{{ t('home.heroTitle') }}</h2>
        <p class="page-description hero-description">{{ t('home.heroDescription') }}</p>

        <div class="cta-group">
          <RouterLink to="/learning/vocabulary" class="button primary hero-button">
            <BookOpen :size="18" />
            {{ t('home.ctaVocabulary') }}
          </RouterLink>
          <RouterLink to="/learning/vocabulary?mode=practice" class="button hero-button">
            <Brain :size="18" />
            {{ t('home.ctaPractice') }}
          </RouterLink>
          <RouterLink to="/games" class="button hero-button">
            <Gamepad2 :size="18" />
            {{ t('home.ctaGamesHub') }}
          </RouterLink>
        </div>

        <div class="quicklink-panel hero-links">
          <RouterLink class="button mini" to="/onboarding">{{ t('onboarding.title') }}</RouterLink>
          <RouterLink class="button mini" to="/explore">{{ t('explore.title') }}</RouterLink>
          <RouterLink class="button mini" to="/faq">{{ t('faq.title') }}</RouterLink>
          <RouterLink class="button mini" to="/updates">{{ t('updates.title') }}</RouterLink>
        </div>
      </div>

      <aside class="hero-panel fade-up">
        <p class="feature-kicker">highlight</p>
        <h3 class="feature-title">{{ t('home.exploreMore') }}</h3>
        <p class="muted">qysyw 静态站把学习、练习、小游戏与辅助内容整合成一个更轻量的探索空间。</p>
        <div class="hero-stat-stack">
          <div class="stat accent-stat">
            <p class="stat-label">
              <Trophy
                :size="16"
                style="display: inline; vertical-align: middle; margin-right: 0.3rem"
              />
              {{ t('home.statMastered') }}
            </p>
            <p class="stat-value">{{ masteredCount }}</p>
          </div>
          <div class="stat accent-stat soft">
            <p class="stat-label">
              <Target
                :size="16"
                style="display: inline; vertical-align: middle; margin-right: 0.3rem"
              />
              {{ t('home.statWrongNotebook') }}
            </p>
            <p class="stat-value">{{ wrongNotebookCount }}</p>
          </div>
          <div class="stat accent-stat mint">
            <p class="stat-label">
              <TrendingUp
                :size="16"
                style="display: inline; vertical-align: middle; margin-right: 0.3rem"
              />
              {{ t('home.statPracticeAccuracy') }}
            </p>
            <p class="stat-value">{{ practiceAccuracy }}%</p>
          </div>
        </div>
      </aside>
    </div>

    <section class="section-space">
      <h3 class="section-header">Main pathways</h3>
      <div class="hub-grid editorial-grid">
        <article class="feature-card spotlight-card fade-up">
          <p class="feature-kicker">{{ t('home.learningLabel') }}</p>
          <h3 class="feature-title">{{ t('home.learningTitle') }}</h3>
          <p class="muted">{{ t('home.learningDescription') }}</p>
          <div class="mini-stats stacked-mini-stats">
            <span>{{ t('home.statMastered') }} · {{ masteredCount }}</span>
            <span>{{ t('home.statWrongNotebook') }} · {{ wrongNotebookCount }}</span>
          </div>
          <div class="cta-group compact-cta-group">
            <RouterLink to="/learning" class="button primary">
              <BookOpen :size="16" />
              {{ t('nav.learning') }}
            </RouterLink>
            <RouterLink to="/learning/resources" class="button">
              {{ t('learningResources.cta') }}
              <ArrowRight :size="16" />
            </RouterLink>
          </div>
        </article>

        <article class="feature-card spotlight-card alt-card fade-up" style="animation-delay: 90ms">
          <p class="feature-kicker">{{ t('home.gamesLabel') }}</p>
          <h3 class="feature-title">{{ t('home.gamesTitle') }}</h3>
          <p class="muted">{{ t('home.gamesDescription') }}</p>
          <div class="mini-stats stacked-mini-stats">
            <span>{{ t('home.statBestGame') }} · {{ bestMoves || '-' }}</span>
            <span
              >{{ t('home.statBestReaction') }} ·
              {{ reactionBest ? `${reactionBest}ms` : '-' }}</span
            >
            <span>{{ t('home.statBestGuess') }} · {{ guessBest || '-' }}</span>
          </div>
          <div class="cta-group compact-cta-group">
            <RouterLink to="/games" class="button primary">
              <Gamepad2 :size="16" />
              {{ t('nav.games') }}
            </RouterLink>
            <RouterLink to="/games/guide" class="button">
              {{ t('gamesGuide.cta') }}
              <ArrowRight :size="16" />
            </RouterLink>
          </div>
        </article>
      </div>
    </section>

    <section class="section-space story-band">
      <div>
        <h3 class="section-header">Curated routes</h3>
        <p class="muted band-copy">
          从快速开始、页面导航到学习方法和游戏攻略，这里把高频入口整理成更顺手的阅读式动线。
        </p>
      </div>
      <RouterLink to="/explore" class="button primary">{{ t('explore.title') }}</RouterLink>
    </section>

    <section class="section-space">
      <h3 class="section-header">{{ t('home.exploreMore') }}</h3>
      <div class="feature-link-grid">
        <RouterLink
          v-for="(item, index) in featureLinks"
          :key="item.to"
          :to="item.to"
          class="feature-card mini-card fade-up quick-destination"
          :style="{ animationDelay: `${index * 70}ms` }"
        >
          <h4>{{ t(item.title) }}</h4>
          <p class="muted">{{ t(item.desc) }}</p>
          <span class="destination-arrow">→</span>
        </RouterLink>
      </div>
    </section>
  </section>
</template>

<style scoped>
.home-shell {
  padding: 1.5rem;
}

.hero-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(290px, 0.85fr);
  gap: 1.2rem;
  align-items: start;
}

.eyebrow {
  margin: 0 0 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  color: var(--accent);
  font-size: 0.76rem;
  font-weight: 700;
}

.hero-title {
  font-size: clamp(1.6rem, 4.3vw, 2.9rem);
  max-width: 11ch;
  line-height: 1.05;
}

.hero-description {
  max-width: 58ch;
  font-size: 1.03rem;
}

.hero-button {
  min-width: 160px;
  text-align: center;
}

.hero-links {
  margin-top: 1.3rem;
}

.hero-panel {
  border: 1px solid var(--line);
  border-radius: 22px;
  padding: 1.1rem;
  background: rgba(255, 255, 255, 0.76);
  box-shadow: var(--shadow);
}

.hero-stat-stack {
  display: grid;
  gap: 0.8rem;
  margin-top: 1rem;
}

.accent-stat {
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.92), rgba(255, 236, 205, 0.85));
}

.accent-stat.soft {
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.92), rgba(255, 223, 214, 0.86));
}

.accent-stat.mint {
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.92), rgba(219, 245, 219, 0.86));
}

.editorial-grid {
  align-items: stretch;
}

.spotlight-card {
  min-height: 100%;
}

.alt-card::before {
  background: var(--section-bg2);
}

.stacked-mini-stats {
  margin-top: 0.8rem;
}

.compact-cta-group {
  margin-top: 1rem;
}

.story-band {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: center;
  border: 1px dashed var(--accent);
  border-radius: 18px;
  padding: 1rem 1.1rem;
  background: rgba(255, 248, 233, 0.8);
}

.band-copy {
  max-width: 60ch;
}

.feature-link-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.9rem;
}

.quick-destination {
  position: relative;
  min-height: 140px;
}

.quick-destination h4 {
  margin: 0 0 0.55rem;
  font-family: 'JetBrains Mono', monospace;
  font-size: 1rem;
}

.destination-arrow {
  position: absolute;
  right: 1rem;
  bottom: 0.9rem;
  font-size: 1.2rem;
  color: var(--accent);
  font-weight: 700;
}

@media (max-width: 920px) {
  .hero-grid,
  .feature-link-grid {
    grid-template-columns: 1fr;
  }

  .story-band {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
