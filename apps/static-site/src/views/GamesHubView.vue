<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useLearningProgressStore } from '@/stores/learningProgress'
import {
  Zap,
  Dices,
  Brain,
  Sparkles,
  Grid3x3,
  Worm,
  Bomb,
  Box,
  Puzzle,
  ArrowRight,
  Hash,
  Target,
  Crosshair,
} from 'lucide-vue-next'

const { t } = useI18n()
const progressStore = useLearningProgressStore()

const memoryBestMoves = computed(() => progressStore.state.game.bestMoves)
const reactionBest = computed(() => progressStore.state.game.reactionBestMs)
const guessBest = computed(() => progressStore.state.game.guessBestAttempts)
const popBestScore = computed(() => progressStore.state.game.popBestScore)
</script>

<template>
  <section class="page-card section-alt1 games-shell">
    <div class="hub-hero">
      <div>
        <p class="feature-kicker">game room</p>
        <h2 class="page-title">{{ t('gamesHub.title') }}</h2>
        <p class="page-description">{{ t('gamesHub.description') }}</p>
      </div>
      <div class="quicklink-panel compact-panel">
        <RouterLink class="button mini" to="/games/guide">{{ t('gamesGuide.title') }}</RouterLink>
        <RouterLink class="button mini" to="/feedback">{{ t('feedback.title') }}</RouterLink>
      </div>
    </div>

    <div class="hub-grid section-space">
      <article class="feature-card route-card">
        <p class="feature-kicker">{{ t('gamesHub.reactionKicker') }}</p>
        <h3 class="feature-title">
          <Zap :size="20" style="display: inline; vertical-align: middle; margin-right: 0.4rem" />
          {{ t('reaction.title') }}
        </h3>
        <p class="muted">{{ t('gamesHub.reactionDesc') }}</p>
        <p class="badge" style="margin-top: 0.4rem">
          {{ t('reaction.best') }}: {{ reactionBest ? `${reactionBest}ms` : '-' }}
        </p>
        <RouterLink
          to="/games/reaction"
          class="button primary"
          style="display: inline-flex; margin-top: 0.8rem"
        >
          {{ t('gamesHub.enterReaction') }}
          <ArrowRight :size="16" />
        </RouterLink>
      </article>

      <article class="feature-card route-card">
        <p class="feature-kicker">{{ t('gamesHub.guessKicker') }}</p>
        <h3 class="feature-title">
          <Dices :size="20" style="display: inline; vertical-align: middle; margin-right: 0.4rem" />
          {{ t('guess.title') }}
        </h3>
        <p class="muted">{{ t('gamesHub.guessDesc') }}</p>
        <p class="badge" style="margin-top: 0.4rem">
          {{ t('guess.best') }}: {{ guessBest || '-' }}
        </p>
        <RouterLink
          to="/games/number-guess"
          class="button primary"
          style="display: inline-flex; margin-top: 0.8rem"
        >
          {{ t('gamesHub.enterGuess') }}
          <ArrowRight :size="16" />
        </RouterLink>
      </article>

      <article class="feature-card route-card">
        <p class="feature-kicker">{{ t('gamesGuide.kicker') }}</p>
        <h3 class="feature-title">{{ t('gamesGuide.title') }}</h3>
        <p class="muted">{{ t('gamesGuide.description') }}</p>
        <RouterLink
          to="/games/guide"
          class="button"
          style="display: inline-flex; margin-top: 0.8rem"
        >
          {{ t('gamesGuide.cta') }}
          <ArrowRight :size="16" />
        </RouterLink>
      </article>

      <article class="feature-card route-card">
        <p class="feature-kicker">{{ t('gamesHub.memoryKicker') }}</p>
        <h3 class="feature-title">
          <Brain :size="20" style="display: inline; vertical-align: middle; margin-right: 0.4rem" />
          {{ t('game.title') }}
        </h3>
        <p class="muted">{{ t('gamesHub.memoryDesc') }}</p>
        <p class="badge" style="margin-top: 0.4rem">
          {{ t('game.bestMoves') }}: {{ memoryBestMoves || '-' }}
        </p>
        <RouterLink
          to="/games/memory"
          class="button"
          style="display: inline-flex; margin-top: 0.8rem"
        >
          {{ t('gamesHub.enterMemory') }}
          <ArrowRight :size="16" />
        </RouterLink>
      </article>

      <article class="feature-card route-card">
        <p class="feature-kicker">{{ t('gamesHub.popKicker') }}</p>
        <h3 class="feature-title">
          <Sparkles
            :size="20"
            style="display: inline; vertical-align: middle; margin-right: 0.4rem"
          />
          {{ t('pop.title') }}
        </h3>
        <p class="muted">{{ t('gamesHub.popDesc') }}</p>
        <p class="badge" style="margin-top: 0.4rem">
          {{ t('pop.best') }}: {{ popBestScore || '-' }}
        </p>
        <RouterLink
          to="/games/pop-blast"
          class="button primary"
          style="display: inline-flex; margin-top: 0.8rem"
        >
          {{ t('gamesHub.enterPop') }}
          <ArrowRight :size="16" />
        </RouterLink>
      </article>
      <article class="feature-card route-card">
        <p class="feature-kicker">{{ t('gamesHub.game2048Kicker') }}</p>
        <h3 class="feature-title">
          <Grid3x3
            :size="20"
            style="display: inline; vertical-align: middle; margin-right: 0.4rem"
          />
          {{ t('gamesHub.game2048Title') }}
        </h3>
        <p class="muted">{{ t('gamesHub.game2048Desc') }}</p>
        <RouterLink
          to="/games/2048"
          class="button"
          style="display: inline-flex; margin-top: 0.8rem"
        >
          {{ t('gamesHub.enterGame2048') }}
          <ArrowRight :size="16" />
        </RouterLink>
      </article>

      <article class="feature-card route-card">
        <p class="feature-kicker">{{ t('gamesHub.snakeKicker') }}</p>
        <h3 class="feature-title">
          <Worm :size="20" style="display: inline; vertical-align: middle; margin-right: 0.4rem" />
          {{ t('gamesHub.snakeTitle') }}
        </h3>
        <p class="muted">{{ t('gamesHub.snakeDesc') }}</p>
        <RouterLink
          to="/games/snake"
          class="button"
          style="display: inline-flex; margin-top: 0.8rem"
        >
          {{ t('gamesHub.enterSnake') }}
          <ArrowRight :size="16" />
        </RouterLink>
      </article>

      <article class="feature-card route-card">
        <p class="feature-kicker">{{ t('gamesHub.minesweeperKicker') }}</p>
        <h3 class="feature-title">
          <Bomb :size="20" style="display: inline; vertical-align: middle; margin-right: 0.4rem" />
          {{ t('gamesHub.minesweeperTitle') }}
        </h3>
        <p class="muted">{{ t('gamesHub.minesweeperDesc') }}</p>
        <RouterLink
          to="/games/minesweeper"
          class="button"
          style="display: inline-flex; margin-top: 0.8rem"
        >
          {{ t('gamesHub.enterMinesweeper') }}
          <ArrowRight :size="16" />
        </RouterLink>
      </article>

      <article class="feature-card route-card">
        <p class="feature-kicker">{{ t('gamesHub.tetrisKicker') }}</p>
        <h3 class="feature-title">
          <Box :size="20" style="display: inline; vertical-align: middle; margin-right: 0.4rem" />
          {{ t('gamesHub.tetrisTitle') }}
        </h3>
        <p class="muted">{{ t('gamesHub.tetrisDesc') }}</p>
        <RouterLink
          to="/games/tetris"
          class="button"
          style="display: inline-flex; margin-top: 0.8rem"
        >
          {{ t('gamesHub.enterTetris') }}
          <ArrowRight :size="16" />
        </RouterLink>
      </article>

      <article class="feature-card route-card">
        <p class="feature-kicker">{{ t('gamesHub.puzzleKicker') }}</p>
        <h3 class="feature-title">
          <Puzzle
            :size="20"
            style="display: inline; vertical-align: middle; margin-right: 0.4rem"
          />
          {{ t('gamesHub.puzzleTitle') }}
        </h3>
        <p class="muted">{{ t('gamesHub.puzzleDesc') }}</p>
        <RouterLink
          to="/games/puzzle"
          class="button"
          style="display: inline-flex; margin-top: 0.8rem"
        >
          {{ t('gamesHub.enterPuzzle') }}
          <ArrowRight :size="16" />
        </RouterLink>
      </article>

      <article class="feature-card route-card">
        <p class="feature-kicker">{{ t('gamesHub.memoryNumberKicker') }}</p>
        <h3 class="feature-title">
          <Hash :size="20" style="display: inline; vertical-align: middle; margin-right: 0.4rem" />
          {{ t('memoryNumber.title') }}
        </h3>
        <p class="muted">{{ t('gamesHub.memoryNumberDesc') }}</p>
        <RouterLink
          to="/games/memory-number"
          class="button primary"
          style="display: inline-flex; margin-top: 0.8rem"
        >
          {{ t('gamesHub.enterMemoryNumber') }}
          <ArrowRight :size="16" />
        </RouterLink>
      </article>

      <article class="feature-card route-card">
        <p class="feature-kicker">{{ t('gamesHub.sequenceKicker') }}</p>
        <h3 class="feature-title">
          <Grid3x3
            :size="20"
            style="display: inline; vertical-align: middle; margin-right: 0.4rem"
          />
          {{ t('sequence.title') }}
        </h3>
        <p class="muted">{{ t('gamesHub.sequenceDesc') }}</p>
        <RouterLink
          to="/games/sequence"
          class="button"
          style="display: inline-flex; margin-top: 0.8rem"
        >
          {{ t('gamesHub.enterSequence') }}
          <ArrowRight :size="16" />
        </RouterLink>
      </article>

      <article class="feature-card route-card">
        <p class="feature-kicker">{{ t('gamesHub.aimTrainKicker') }}</p>
        <h3 class="feature-title">
          <Target
            :size="20"
            style="display: inline; vertical-align: middle; margin-right: 0.4rem"
          />
          {{ t('aimTrain.title') }}
        </h3>
        <p class="muted">{{ t('gamesHub.aimTrainDesc') }}</p>
        <RouterLink
          to="/games/aim-train"
          class="button"
          style="display: inline-flex; margin-top: 0.8rem"
        >
          {{ t('gamesHub.enterAimTrain') }}
          <ArrowRight :size="16" />
        </RouterLink>
      </article>

      <article class="feature-card route-card">
        <p class="feature-kicker">{{ t('gamesHub.shootingKicker') }}</p>
        <h3 class="feature-title">
          <Crosshair
            :size="20"
            style="display: inline; vertical-align: middle; margin-right: 0.4rem"
          />
          {{ t('shooting.title') }}
        </h3>
        <p class="muted">{{ t('gamesHub.shootingDesc') }}</p>
        <RouterLink
          to="/games/shooting"
          class="button primary"
          style="display: inline-flex; margin-top: 0.8rem"
        >
          {{ t('gamesHub.enterShooting') }}
          <ArrowRight :size="16" />
        </RouterLink>
      </article>
    </div>

    <section class="section-space split-band">
      <div>
        <h3 class="section-header">Play rhythm</h3>
        <p class="muted">
          交替体验反应、策略、记忆与经典街机玩法，让休闲挑战更有节奏，也更容易找到自己偏爱的小游戏类型。
        </p>
      </div>
      <div class="mini-stats stacked-mini-stats">
        <span>{{ t('reaction.best') }} · {{ reactionBest ? `${reactionBest}ms` : '-' }}</span>
        <span>{{ t('guess.best') }} · {{ guessBest || '-' }}</span>
        <span>{{ t('pop.best') }} · {{ popBestScore || '-' }}</span>
      </div>
    </section>
  </section>
</template>

<style scoped>
.games-shell {
  padding: 1.5rem;
}

.hub-hero {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: flex-start;
}

.route-card {
  min-height: 230px;
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

.stacked-mini-stats {
  flex-direction: column;
  align-items: flex-start;
}

.compact-panel {
  justify-content: flex-end;
}

@media (max-width: 920px) {
  .hub-hero,
  .split-band {
    flex-direction: column;
  }

  .compact-panel {
    justify-content: flex-start;
  }
}
</style>
