<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useLearningProgressStore } from '@/stores/learningProgress'

type ReactionPhase = 'idle' | 'waiting' | 'ready' | 'result'

const { t } = useI18n()
const progressStore = useLearningProgressStore()

const phase = ref<ReactionPhase>('idle')
const tip = ref('')
const lastResultMs = ref(0)
const waitingTimeout = ref<ReturnType<typeof setTimeout> | null>(null)
let readyAt = 0

const bestResultMs = computed(() => progressStore.state.game.reactionBestMs)
const totalPlays = computed(() => progressStore.state.game.reactionPlays)
const averageMs = computed(() => progressStore.reactionAverageMs)

const clearWaitingTimeout = (): void => {
  if (waitingTimeout.value) {
    clearTimeout(waitingTimeout.value)
    waitingTimeout.value = null
  }
}

const startChallenge = (): void => {
  clearWaitingTimeout()
  phase.value = 'waiting'
  tip.value = t('reaction.waitTip')

  const delay = 1200 + Math.floor(Math.random() * 2200)
  waitingTimeout.value = setTimeout(() => {
    phase.value = 'ready'
    tip.value = t('reaction.tapNow')
    readyAt = performance.now()
    waitingTimeout.value = null
  }, delay)
}

const handleTap = (): void => {
  if (phase.value === 'idle' || phase.value === 'result') {
    startChallenge()
    return
  }

  if (phase.value === 'waiting') {
    clearWaitingTimeout()
    phase.value = 'idle'
    tip.value = t('reaction.tooSoon')
    return
  }

  const result = Math.max(1, Math.round(performance.now() - readyAt))
  lastResultMs.value = result
  phase.value = 'result'
  tip.value = t('reaction.resultTip')
  progressStore.saveReactionScore(result)
}

onBeforeUnmount(() => {
  clearWaitingTimeout()
})
</script>

<template>
  <section class="page-card">
    <h2 class="page-title">{{ t('reaction.title') }}</h2>
    <p class="page-description">{{ t('reaction.description') }}</p>

    <div class="grid cards-3" style="margin-bottom: 1rem">
      <div class="stat">
        <p class="stat-label">{{ t('reaction.latest') }}</p>
        <p class="stat-value">{{ lastResultMs ? `${lastResultMs}ms` : '-' }}</p>
      </div>
      <div class="stat">
        <p class="stat-label">{{ t('reaction.best') }}</p>
        <p class="stat-value">{{ bestResultMs ? `${bestResultMs}ms` : '-' }}</p>
      </div>
      <div class="stat">
        <p class="stat-label">{{ t('reaction.average') }}</p>
        <p class="stat-value">{{ averageMs ? `${averageMs}ms` : '-' }}</p>
      </div>
      <div class="stat">
        <p class="stat-label">{{ t('reaction.plays') }}</p>
        <p class="stat-value">{{ totalPlays }}</p>
      </div>
    </div>

    <button class="reaction-pad" :class="`phase-${phase}`" type="button" @pointerdown="handleTap">
      <span>{{ t('reaction.tapArea') }}</span>
      <strong>{{ tip || t('reaction.idleTip') }}</strong>
    </button>

    <div class="toolbar" style="margin-top: 0.9rem">
      <button class="button" type="button" @click="startChallenge">
        {{ t('reaction.start') }}
      </button>
      <RouterLink to="/games" class="button ghost">{{ t('gamesHub.backToHub') }}</RouterLink>
    </div>
  </section>
</template>
