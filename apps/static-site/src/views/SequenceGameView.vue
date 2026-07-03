<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useLearningProgressStore } from '@/stores/learningProgress'

type GamePhase = 'idle' | 'playing' | 'result'

interface Cell {
  number: number
  clicked: boolean
}

const { t } = useI18n()
const progressStore = useLearningProgressStore()

const phase = ref<GamePhase>('idle')
const grid = ref<Cell[]>([])
const currentTarget = ref(1)
const errors = ref(0)
const startTime = ref(0)
const elapsedTime = ref(0)
const timerInterval = ref<ReturnType<typeof setInterval> | null>(null)

const bestTime = computed(() => progressStore.state.game.sequenceBestMs || 0)
const totalPlays = computed(() => progressStore.state.game.sequencePlays || 0)
const bestErrors = computed(() => progressStore.state.game.sequenceBestErrors ?? 999)

const shuffleArray = <T,>(array: T[]): T[] => {
  const result = [...array]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const current = result[i]!
    const target = result[j]!
    result[i] = target
    result[j] = current
  }
  return result
}

const startGame = (): void => {
  const numbers = Array.from({ length: 25 }, (_, i) => i + 1)
  const shuffled = shuffleArray(numbers)
  grid.value = shuffled.map((num) => ({ number: num, clicked: false }))
  currentTarget.value = 1
  errors.value = 0
  phase.value = 'playing'
  startTime.value = performance.now()

  if (timerInterval.value) clearInterval(timerInterval.value)
  timerInterval.value = setInterval(() => {
    elapsedTime.value = Math.floor((performance.now() - startTime.value) / 1000)
  }, 100)
}

const handleCellClick = (cell: Cell): void => {
  if (phase.value !== 'playing' || cell.clicked) return

  if (cell.number === currentTarget.value) {
    cell.clicked = true
    currentTarget.value += 1

    if (currentTarget.value > 25) {
      finishGame()
    }
  } else {
    errors.value += 1
  }
}

const finishGame = (): void => {
  if (timerInterval.value) {
    clearInterval(timerInterval.value)
    timerInterval.value = null
  }

  const finalTime = Math.floor(performance.now() - startTime.value)
  phase.value = 'result'
  progressStore.saveSequenceScore(finalTime, errors.value)
}

onBeforeUnmount(() => {
  if (timerInterval.value) {
    clearInterval(timerInterval.value)
  }
})
</script>

<template>
  <section class="page-card">
    <h2 class="page-title">{{ t('sequence.title') }}</h2>
    <p class="page-description">{{ t('sequence.description') }}</p>

    <div class="grid cards-3" style="margin-bottom: 1rem">
      <div class="stat">
        <p class="stat-label">{{ t('sequence.bestTime') }}</p>
        <p class="stat-value">{{ bestTime ? `${(bestTime / 1000).toFixed(1)}s` : '-' }}</p>
      </div>
      <div class="stat">
        <p class="stat-label">{{ t('sequence.bestErrors') }}</p>
        <p class="stat-value">{{ bestErrors < 999 ? bestErrors : '-' }}</p>
      </div>
      <div class="stat">
        <p class="stat-label">{{ t('sequence.plays') }}</p>
        <p class="stat-value">{{ totalPlays }}</p>
      </div>
    </div>

    <div class="game-area">
      <div v-if="phase === 'idle'" class="game-message">
        <p>{{ t('sequence.idleTip') }}</p>
      </div>

      <div v-else-if="phase === 'playing'" class="playing-area">
        <div class="game-info">
          <span
            >{{ t('sequence.target') }}: <strong>{{ currentTarget }}</strong></span
          >
          <span
            >{{ t('sequence.time') }}: <strong>{{ elapsedTime }}s</strong></span
          >
          <span
            >{{ t('sequence.errors') }}: <strong>{{ errors }}</strong></span
          >
        </div>
        <div class="grid-container">
          <button
            v-for="(cell, index) in grid"
            :key="index"
            class="grid-cell"
            :class="{ clicked: cell.clicked }"
            :disabled="cell.clicked"
            @click="handleCellClick(cell)"
          >
            {{ cell.number }}
          </button>
        </div>
      </div>

      <div v-else-if="phase === 'result'" class="result-area">
        <p class="result-message">{{ t('sequence.complete') }}</p>
        <p class="result-detail">{{ t('sequence.finalTime') }}: {{ elapsedTime.toFixed(1) }}s</p>
        <p class="result-detail">{{ t('sequence.finalErrors') }}: {{ errors }}</p>
      </div>
    </div>

    <div class="toolbar" style="margin-top: 0.9rem">
      <button class="button" type="button" @click="startGame">
        {{ phase === 'result' ? t('sequence.playAgain') : t('sequence.start') }}
      </button>
      <RouterLink to="/games" class="button ghost">{{ t('gamesHub.backToHub') }}</RouterLink>
    </div>
  </section>
</template>

<style scoped>
.game-area {
  min-height: 400px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.5);
  border-radius: 12px;
  padding: 2rem;
  margin: 1rem 0;
}

.playing-area {
  width: 100%;
  max-width: 600px;
}

.game-info {
  display: flex;
  justify-content: space-around;
  margin-bottom: 1.5rem;
  font-size: 1.1rem;
  color: var(--text-secondary);
}

.grid-container {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 0.5rem;
  aspect-ratio: 1;
}

.grid-cell {
  aspect-ratio: 1;
  border: 2px solid var(--border-color);
  border-radius: 8px;
  background: white;
  font-size: 1.5rem;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.2s;
}

.grid-cell:hover:not(:disabled) {
  background: var(--primary-color);
  color: white;
  transform: scale(1.05);
}

.grid-cell.clicked {
  background: #22c55e;
  color: white;
  cursor: not-allowed;
  opacity: 0.6;
}

.game-message {
  font-size: 1.2rem;
  color: var(--text-secondary);
  text-align: center;
}

.result-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.8rem;
}

.result-message {
  font-size: 2rem;
  font-weight: bold;
  color: #22c55e;
  margin: 0;
}

.result-detail {
  font-size: 1.2rem;
  color: var(--text-secondary);
  margin: 0;
}

@media (max-width: 768px) {
  .grid-cell {
    font-size: 1.2rem;
  }

  .game-info {
    flex-direction: column;
    gap: 0.5rem;
    text-align: center;
  }
}
</style>
