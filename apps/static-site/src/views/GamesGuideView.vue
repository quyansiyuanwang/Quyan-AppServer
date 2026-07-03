<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const games = [
  {
    title: 'reactionTitle',
    desc: 'reactionDesc',
    tips: ['reactionTip1', 'reactionTip2', 'reactionTip3', 'reactionTip4'],
  },
  {
    title: 'guessTitle',
    desc: 'guessDesc',
    tips: ['guessTip1', 'guessTip2', 'guessTip3', 'guessTip4'],
  },
  {
    title: 'memoryTitle',
    desc: 'memoryDesc',
    tips: ['memoryTip1', 'memoryTip2', 'memoryTip3'],
  },
  {
    title: 'popTitle',
    desc: 'popDesc',
    tips: ['popTip1', 'popTip2', 'popTip3', 'popTip4'],
  },
]

const classicGames = [
  { name: '2048', tip: 'game2048Tip' },
  { name: 'Snake', tip: 'snakeTip' },
  { name: 'Minesweeper', tip: 'minesweeperTip' },
  { name: 'Tetris', tip: 'tetrisTip' },
  { name: 'Puzzle', tip: 'puzzleTip' },
]
</script>

<template>
  <section class="page-card guide-shell">
    <h2 class="page-title">{{ t('gamesGuide.title') }}</h2>
    <p class="page-description">{{ t('gamesGuide.description') }}</p>

    <div v-for="game in games" :key="game.title" class="content-section">
      <h3 class="section-header">{{ t(`gamesGuide.${game.title}`) }}</h3>
      <p class="muted">{{ t(`gamesGuide.${game.desc}`) }}</p>
      <ul class="tips-list">
        <li v-for="tip in game.tips" :key="tip">{{ t(`gamesGuide.${tip}`) }}</li>
      </ul>
    </div>

    <div class="content-section">
      <h3 class="section-header">{{ t('gamesGuide.classicGamesTitle') }}</h3>
      <p class="muted">{{ t('gamesGuide.classicGamesDesc') }}</p>
      <div class="classic-grid">
        <article v-for="game in classicGames" :key="game.name" class="classic-card">
          <h4 class="classic-title">{{ game.name }}</h4>
          <p class="muted">{{ t(`gamesGuide.${game.tip}`) }}</p>
        </article>
      </div>
    </div>
  </section>
</template>

<style scoped>
.guide-shell {
  padding: 1.5rem;
}

.content-section {
  margin-top: 2rem;
}

.content-section p {
  line-height: 1.7;
}

.tips-list {
  margin: 1rem 0 0 1.5rem;
  padding: 0;
  line-height: 1.8;
}

.tips-list li {
  margin-top: 0.5rem;
}

.classic-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 1rem;
  margin-top: 1rem;
}

.classic-card {
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 1rem;
  background: rgba(255, 255, 255, 0.82);
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease;
}

.classic-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 20px rgba(26, 111, 95, 0.12);
}

.classic-title {
  margin: 0 0 0.5rem;
  font-family: 'JetBrains Mono', monospace;
  font-size: 1rem;
  color: var(--primary);
}

.classic-card p {
  margin: 0;
  font-size: 0.95rem;
}
</style>
