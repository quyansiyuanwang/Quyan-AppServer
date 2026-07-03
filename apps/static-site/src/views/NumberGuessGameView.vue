<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useLearningProgressStore } from '@/stores/learningProgress'

const { t } = useI18n()
const progressStore = useLearningProgressStore()

const target = ref(0)
const inputValue = ref<number | null>(null)
const attempts = ref(0)
const history = ref<string[]>([])
const won = ref(false)

const bestAttempts = computed(() => progressStore.state.game.guessBestAttempts)
const totalWins = computed(() => progressStore.state.game.guessWins)

const resetGame = (): void => {
  target.value = Math.floor(Math.random() * 100) + 1
  inputValue.value = null
  attempts.value = 0
  history.value = []
  won.value = false
}

const submitGuess = (): void => {
  const guess = inputValue.value
  if (guess === null || !Number.isFinite(guess)) return

  const safeGuess = Math.max(1, Math.min(100, Math.floor(guess)))
  inputValue.value = safeGuess
  attempts.value += 1

  if (safeGuess === target.value) {
    history.value = [
      `${t('guess.correct')}: ${safeGuess} (${t('guess.attemptLabel')} ${attempts.value})`,
      ...history.value,
    ]
    won.value = true
    progressStore.saveGuessRecord(attempts.value)
    return
  }

  if (safeGuess < target.value) {
    history.value = [`${safeGuess} → ${t('guess.higher')}`, ...history.value]
    return
  }

  history.value = [`${safeGuess} → ${t('guess.lower')}`, ...history.value]
}

resetGame()
</script>

<template>
  <section class="page-card">
    <h2 class="page-title">{{ t('guess.title') }}</h2>
    <p class="page-description">{{ t('guess.description') }}</p>

    <div class="grid cards-3" style="margin-bottom: 1rem">
      <div class="stat">
        <p class="stat-label">{{ t('guess.attempts') }}</p>
        <p class="stat-value">{{ attempts }}</p>
      </div>
      <div class="stat">
        <p class="stat-label">{{ t('guess.best') }}</p>
        <p class="stat-value">{{ bestAttempts || '-' }}</p>
      </div>
      <div class="stat">
        <p class="stat-label">{{ t('guess.wins') }}</p>
        <p class="stat-value">{{ totalWins }}</p>
      </div>
    </div>

    <div class="toolbar" style="margin-bottom: 0.8rem">
      <input
        v-model.number="inputValue"
        class="input"
        type="number"
        min="1"
        max="100"
        :placeholder="t('guess.placeholder')"
        :disabled="won"
        @keyup.enter="submitGuess"
      />
      <button class="button primary" type="button" :disabled="won" @click="submitGuess">
        {{ t('guess.submit') }}
      </button>
      <button class="button" type="button" @click="resetGame">{{ t('guess.restart') }}</button>
      <span class="badge" v-if="won">{{ t('guess.winBadge') }}</span>
      <RouterLink to="/games" class="button ghost">{{ t('gamesHub.backToHub') }}</RouterLink>
    </div>

    <div class="guess-history">
      <p class="stat-label" style="margin-bottom: 0.45rem">{{ t('guess.history') }}</p>
      <ul>
        <li v-for="item in history" :key="item">{{ item }}</li>
      </ul>
    </div>
  </section>
</template>
