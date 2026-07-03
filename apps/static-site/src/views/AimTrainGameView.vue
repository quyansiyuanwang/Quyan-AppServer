<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useLearningProgressStore } from '@/stores/learningProgress'

interface Target {
  id: number
  x: number
}

const { t } = useI18n()
const progressStore = useLearningProgressStore()

const isPlaying = ref(false)
const targets = ref<Target[]>([])
const score = ref(0)
const timeLeft = ref(30)
const nextId = ref(0)
const timerInterval = ref<ReturnType<typeof setInterval> | null>(null)

const bestScore = computed(() => progressStore.state.game.aimTrainBestScore || 0)
const totalPlays = computed(() => progressStore.state.game.aimTrainPlays || 0)

const spawnTarget = (): void => {
  const x = Math.random() * 80 + 10
  targets.value = [{ id: nextId.value++, x }]
}

const startGame = (): void => {
  isPlaying.value = true
  score.value = 0
  timeLeft.value = 30
  targets.value = []
  nextId.value = 0

  spawnTarget()

  if (timerInterval.value) clearInterval(timerInterval.value)
  timerInterval.value = setInterval(() => {
    timeLeft.value -= 1
    if (timeLeft.value <= 0) {
      endGame()
    }
  }, 1000)
}

const hitTarget = (targetId: number): void => {
  if (!isPlaying.value) return

  targets.value = targets.value.filter((t) => t.id !== targetId)
  score.value += 1
  spawnTarget()
}

const endGame = (): void => {
  isPlaying.value = false
  if (timerInterval.value) {
    clearInterval(timerInterval.value)
    timerInterval.value = null
  }
  targets.value = []
  progressStore.saveAimTrainScore(score.value)
}

onBeforeUnmount(() => {
  if (timerInterval.value) {
    clearInterval(timerInterval.value)
  }
})
</script>

<template>
  <section class="page-card">
    <h2 class="page-title">{{ t('aimTrain.title') }}</h2>
    <p class="page-description">{{ t('aimTrain.description') }}</p>

    <div class="grid cards-3" style="margin-bottom: 1rem">
      <div class="stat">
        <p class="stat-label">{{ t('aimTrain.score') }}</p>
        <p class="stat-value">{{ score }}</p>
      </div>
      <div class="stat">
        <p class="stat-label">{{ t('aimTrain.bestScore') }}</p>
        <p class="stat-value">{{ bestScore }}</p>
      </div>
      <div class="stat">
        <p class="stat-label">{{ t('aimTrain.plays') }}</p>
        <p class="stat-value">{{ totalPlays }}</p>
      </div>
    </div>

    <div class="game-container">
      <div v-if="!isPlaying" class="game-message">
        <p>{{ t('aimTrain.idleTip') }}</p>
      </div>

      <div v-else class="game-area">
        <div class="game-info">
          <span
            >{{ t('aimTrain.timeLeft') }}: <strong>{{ timeLeft }}s</strong></span
          >
        </div>
        <div class="shooting-line">
          <button
            v-for="target in targets"
            :key="target.id"
            class="target"
            :style="{ left: `${target.x}%` }"
            @click="hitTarget(target.id)"
          >
            🎯
          </button>
        </div>
      </div>
    </div>

    <div class="toolbar" style="margin-top: 0.9rem">
      <button class="button" type="button" @click="startGame">
        {{ isPlaying ? t('aimTrain.restart') : t('aimTrain.start') }}
      </button>
      <RouterLink to="/games" class="button ghost">{{ t('gamesHub.backToHub') }}</RouterLink>
    </div>
  </section>
</template>

<style scoped>
.game-container {
  min-height: 300px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.5);
  border-radius: 12px;
  padding: 2rem;
  margin: 1rem 0;
}

.game-area {
  width: 100%;
}

.game-info {
  text-align: center;
  font-size: 1.2rem;
  margin-bottom: 2rem;
  color: var(--text-secondary);
}

.shooting-line {
  position: relative;
  width: 100%;
  height: 100px;
  background: linear-gradient(to bottom, transparent 48%, #ddd 48%, #ddd 52%, transparent 52%);
  border-radius: 8px;
}

.target {
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  font-size: 3rem;
  background: none;
  border: none;
  cursor: crosshair;
  transition: transform 0.1s;
  padding: 0;
}

.target:hover {
  transform: translate(-50%, -50%) scale(1.2);
}

.game-message {
  font-size: 1.2rem;
  color: var(--text-secondary);
  text-align: center;
}
</style>
