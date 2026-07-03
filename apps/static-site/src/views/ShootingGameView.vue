<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useLearningProgressStore } from '@/stores/learningProgress'

interface Target {
  id: number
  x: number
  y: number
}

const { t } = useI18n()
const progressStore = useLearningProgressStore()

const isPlaying = ref(false)
const targets = ref<Target[]>([])
const score = ref(0)
const timeLeft = ref(30)
const nextId = ref(0)
const timerInterval = ref<ReturnType<typeof setInterval> | null>(null)

const bestScore = computed(() => progressStore.state.game.shootingBestScore || 0)
const totalPlays = computed(() => progressStore.state.game.shootingPlays || 0)

const spawnTarget = (): void => {
  const x = Math.random() * 80 + 10
  const y = Math.random() * 70 + 10
  targets.value.push({ id: nextId.value++, x, y })
}

const startGame = (): void => {
  isPlaying.value = true
  score.value = 0
  timeLeft.value = 30
  targets.value = []
  nextId.value = 0

  for (let i = 0; i < 5; i++) {
    spawnTarget()
  }

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

  const index = targets.value.findIndex((t) => t.id === targetId)
  if (index !== -1) {
    targets.value.splice(index, 1)
    score.value += 1
    spawnTarget()
  }
}

const endGame = (): void => {
  isPlaying.value = false
  if (timerInterval.value) {
    clearInterval(timerInterval.value)
    timerInterval.value = null
  }
  targets.value = []
  progressStore.saveShootingScore(score.value)
}

onBeforeUnmount(() => {
  if (timerInterval.value) {
    clearInterval(timerInterval.value)
  }
})
</script>

<template>
  <section class="page-card">
    <h2 class="page-title">{{ t('shooting.title') }}</h2>
    <p class="page-description">{{ t('shooting.description') }}</p>

    <div class="grid cards-3" style="margin-bottom: 1rem">
      <div class="stat">
        <p class="stat-label">{{ t('shooting.score') }}</p>
        <p class="stat-value">{{ score }}</p>
      </div>
      <div class="stat">
        <p class="stat-label">{{ t('shooting.bestScore') }}</p>
        <p class="stat-value">{{ bestScore }}</p>
      </div>
      <div class="stat">
        <p class="stat-label">{{ t('shooting.plays') }}</p>
        <p class="stat-value">{{ totalPlays }}</p>
      </div>
    </div>

    <div class="game-container">
      <div v-if="!isPlaying" class="game-message">
        <p>{{ t('shooting.idleTip') }}</p>
      </div>

      <div v-else class="game-area">
        <div class="game-info">
          <span
            >{{ t('shooting.timeLeft') }}: <strong>{{ timeLeft }}s</strong></span
          >
          <span
            >{{ t('shooting.targets') }}: <strong>{{ targets.length }}</strong></span
          >
        </div>
        <div class="shooting-area">
          <button
            v-for="target in targets"
            :key="target.id"
            class="target"
            :style="{ left: `${target.x}%`, top: `${target.y}%` }"
            @click="hitTarget(target.id)"
          >
            🎯
          </button>
        </div>
      </div>
    </div>

    <div class="toolbar" style="margin-top: 0.9rem">
      <button class="button" type="button" @click="startGame">
        {{ isPlaying ? t('shooting.restart') : t('shooting.start') }}
      </button>
      <RouterLink to="/games" class="button ghost">{{ t('gamesHub.backToHub') }}</RouterLink>
    </div>
  </section>
</template>

<style scoped>
.game-container {
  min-height: 400px;
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
  display: flex;
  justify-content: space-around;
  text-align: center;
  font-size: 1.2rem;
  margin-bottom: 1.5rem;
  color: var(--text-secondary);
}

.shooting-area {
  position: relative;
  width: 100%;
  height: 400px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 12px;
  overflow: hidden;
}

.target {
  position: absolute;
  transform: translate(-50%, -50%);
  font-size: 3rem;
  background: none;
  border: none;
  cursor: crosshair;
  transition: transform 0.1s;
  padding: 0;
  animation: pulse 1s infinite;
}

.target:hover {
  transform: translate(-50%, -50%) scale(1.3);
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.7;
  }
}

.game-message {
  font-size: 1.2rem;
  color: var(--text-secondary);
  text-align: center;
}

@media (max-width: 768px) {
  .shooting-area {
    height: 300px;
  }

  .target {
    font-size: 2.5rem;
  }
}
</style>
