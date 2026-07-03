<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useLearningProgressStore } from '@/stores/learningProgress'

type GamePhase = 'idle' | 'showing' | 'input' | 'result'
type Difficulty = 800 | 500 | 200 | 100

const { t } = useI18n()
const progressStore = useLearningProgressStore()

const phase = ref<GamePhase>('idle')
const targetNumber = ref('')
const userInput = ref('')
const showTimeout = ref<ReturnType<typeof setTimeout> | null>(null)
const lastCorrect = ref(false)
const lastTime = ref(0)
const difficulty = ref<Difficulty>(500)
const inputStartTime = ref(0)

const bestTime = computed(() => progressStore.state.game.memoryNumberBestMs || 0)
const totalPlays = computed(() => progressStore.state.game.memoryNumberPlays || 0)
const accuracy = computed(() => {
  const total = progressStore.state.game.memoryNumberPlays || 0
  const correct = progressStore.state.game.memoryNumberCorrect || 0
  return total > 0 ? Math.round((correct / total) * 100) : 0
})

const clearShowTimeout = (): void => {
  if (showTimeout.value) {
    clearTimeout(showTimeout.value)
    showTimeout.value = null
  }
}

const generateNumber = (): string => {
  let result = ''
  for (let i = 0; i < 6; i++) {
    result += Math.floor(Math.random() * 10)
  }
  return result
}

const startGame = (): void => {
  clearShowTimeout()
  userInput.value = ''
  targetNumber.value = generateNumber()
  phase.value = 'showing'

  showTimeout.value = setTimeout(() => {
    phase.value = 'input'
    inputStartTime.value = performance.now()
    showTimeout.value = null
  }, difficulty.value)
}

const submitAnswer = (): void => {
  if (phase.value !== 'input') return
  if (userInput.value.length !== 6) return

  const responseTime = Math.round(performance.now() - inputStartTime.value)
  const isCorrect = userInput.value === targetNumber.value
  lastCorrect.value = isCorrect
  lastTime.value = responseTime
  phase.value = 'result'

  progressStore.saveMemoryNumberScore(responseTime, isCorrect)
}

const handleKeyPress = (e: KeyboardEvent): void => {
  if (e.key === 'Enter' && phase.value === 'input' && userInput.value.length === 6) {
    submitAnswer()
  }
}

onBeforeUnmount(() => {
  clearShowTimeout()
})
</script>

<template>
  <section class="page-card">
    <h2 class="page-title">{{ t('memoryNumber.title') }}</h2>
    <p class="page-description">{{ t('memoryNumber.description') }}</p>

    <div class="grid cards-3" style="margin-bottom: 1rem">
      <div class="stat">
        <p class="stat-label">{{ t('memoryNumber.bestTime') }}</p>
        <p class="stat-value">{{ bestTime ? `${bestTime}ms` : '-' }}</p>
      </div>
      <div class="stat">
        <p class="stat-label">{{ t('memoryNumber.accuracy') }}</p>
        <p class="stat-value">{{ accuracy ? `${accuracy}%` : '-' }}</p>
      </div>
      <div class="stat">
        <p class="stat-label">{{ t('memoryNumber.plays') }}</p>
        <p class="stat-value">{{ totalPlays }}</p>
      </div>
    </div>

    <div v-if="true" class="difficulty-selector">
      <label class="difficulty-label">{{ t('memoryNumber.difficulty') }}:</label>
      <div class="difficulty-buttons">
        <button
          class="difficulty-btn"
          :class="{ active: difficulty === 800 }"
          @click="difficulty = 800"
        >
          {{ t('memoryNumber.easy') }} (0.8s)
        </button>
        <button
          class="difficulty-btn"
          :class="{ active: difficulty === 500 }"
          @click="difficulty = 500"
        >
          {{ t('memoryNumber.normal') }} (0.5s)
        </button>
        <button
          class="difficulty-btn"
          :class="{ active: difficulty === 200 }"
          @click="difficulty = 200"
        >
          {{ t('memoryNumber.hard') }} (0.2s)
        </button>
        <button
          class="difficulty-btn"
          :class="{ active: difficulty === 100 }"
          @click="difficulty = 100"
        >
          {{ t('memoryNumber.expert') }} (0.1s)
        </button>
      </div>
    </div>

    <div class="memory-number-area">
      <div v-if="phase === 'idle'" class="game-message">
        <p>{{ t('memoryNumber.idleTip') }}</p>
      </div>

      <div v-else-if="phase === 'showing'" class="number-display">
        <p class="big-number">{{ targetNumber }}</p>
      </div>

      <div v-else-if="phase === 'input'" class="input-area">
        <p class="game-message">{{ t('memoryNumber.inputTip') }}</p>
        <input
          v-model="userInput"
          type="text"
          maxlength="6"
          pattern="[0-9]*"
          inputmode="numeric"
          class="number-input"
          :placeholder="t('memoryNumber.placeholder')"
          @keypress="handleKeyPress"
          autofocus
        />
        <button class="button primary" :disabled="userInput.length !== 6" @click="submitAnswer">
          {{ t('memoryNumber.submit') }}
        </button>
      </div>

      <div v-else-if="phase === 'result'" class="result-area">
        <p class="result-message" :class="lastCorrect ? 'correct' : 'incorrect'">
          {{ lastCorrect ? t('memoryNumber.correct') : t('memoryNumber.incorrect') }}
        </p>
        <p class="result-detail">{{ t('memoryNumber.answer') }}: {{ targetNumber }}</p>
        <p class="result-detail">{{ t('memoryNumber.yourAnswer') }}: {{ userInput }}</p>
      </div>
    </div>

    <div class="toolbar" style="margin-top: 0.9rem">
      <button class="button" type="button" @click="startGame">
        {{ phase === 'result' ? t('memoryNumber.playAgain') : t('memoryNumber.start') }}
      </button>
      <RouterLink to="/games" class="button ghost">{{ t('gamesHub.backToHub') }}</RouterLink>
    </div>
  </section>
</template>

<style scoped>
.memory-number-area {
  min-height: 300px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.5);
  border-radius: 12px;
  padding: 2rem;
  margin: 1rem 0;
}

.number-display {
  text-align: center;
}

.big-number {
  font-size: 4rem;
  font-weight: bold;
  letter-spacing: 0.5rem;
  color: var(--primary-color);
  margin: 0;
}

.input-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  width: 100%;
  max-width: 400px;
}

.number-input {
  width: 100%;
  padding: 1rem;
  font-size: 2rem;
  text-align: center;
  letter-spacing: 0.5rem;
  border: 2px solid var(--border-color);
  border-radius: 8px;
  font-family: monospace;
}

.number-input:focus {
  outline: none;
  border-color: var(--primary-color);
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
  margin: 0;
}

.result-message.correct {
  color: #22c55e;
}

.result-message.incorrect {
  color: #ef4444;
}

.result-detail {
  font-size: 1.2rem;
  color: var(--text-secondary);
  margin: 0;
}

@media (max-width: 768px) {
  .big-number {
    font-size: 3rem;
  }

  .number-input {
    font-size: 1.5rem;
  }

  .difficulty-buttons {
    flex-direction: column;
  }

  .difficulty-btn {
    width: 100%;
  }
}

.difficulty-selector {
  margin-bottom: 1rem;
  padding: 1rem;
  background: rgba(255, 255, 255, 0.7);
  border-radius: 8px;
}

.difficulty-label {
  display: block;
  font-size: 1rem;
  font-weight: 600;
  margin-bottom: 0.8rem;
  color: var(--text-primary);
}

.difficulty-buttons {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.difficulty-btn {
  flex: 1;
  min-width: 120px;
  padding: 0.6rem 1rem;
  border: 2px solid var(--border-color);
  border-radius: 6px;
  background: white;
  font-size: 0.9rem;
  cursor: pointer;
  transition: all 0.2s;
}

.difficulty-btn:hover {
  border-color: var(--primary-color);
  background: rgba(var(--primary-color-rgb), 0.1);
}

.difficulty-btn.active {
  border-color: var(--primary-color);
  background: var(--primary-color);
  color: rgb(255, 0, 0);
  font-weight: 600;
}
</style>
