<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ALL_WORD_CATEGORY_ID, getMemoryGameWords, listWordCategories } from '@/data/vocabulary'
import { shuffle } from '@/utils/shuffle'
import { useLearningProgressStore } from '@/stores/learningProgress'
import type { MemoryCard, VocabularyWord } from '@/types/learning'

const { t } = useI18n()
const progressStore = useLearningProgressStore()

const cards = ref<MemoryCard[]>([])
const openedIndices = ref<number[]>([])
const matchedPairIds = ref<string[]>([])
const moves = ref(0)
const seconds = ref(0)
const started = ref(false)
const completed = ref(false)
const lockBoard = ref(false)
const categoryId = ref(ALL_WORD_CATEGORY_ID)
const sourcePairs = ref<VocabularyWord[]>([])
const memoryLoading = ref(false)
const memoryLoadFailed = ref(false)
const roundRequestId = ref(0)

let timer: ReturnType<typeof setInterval> | null = null
let flipBackTimer: ReturnType<typeof setTimeout> | null = null

const categoryOptions = computed(() => listWordCategories())

const clearTimers = (): void => {
  if (timer) {
    clearInterval(timer)
    timer = null
  }

  if (flipBackTimer) {
    clearTimeout(flipBackTimer)
    flipBackTimer = null
  }
}

const startRound = async (): Promise<void> => {
  clearTimers()

  const requestId = roundRequestId.value + 1
  roundRequestId.value = requestId

  memoryLoading.value = true
  memoryLoadFailed.value = false
  lockBoard.value = true

  try {
    sourcePairs.value = await getMemoryGameWords(categoryId.value, 6)
  } catch {
    if (requestId !== roundRequestId.value) return
    sourcePairs.value = []
    memoryLoadFailed.value = true
  }

  if (requestId !== roundRequestId.value) return

  const pool = sourcePairs.value

  const generated = pool.flatMap((item) => {
    return [
      {
        id: `${item.id}-word`,
        pairId: item.id,
        text: item.word,
      },
      {
        id: `${item.id}-meaning`,
        pairId: item.id,
        text: item.meaning,
      },
    ]
  })

  cards.value = shuffle(generated)
  openedIndices.value = []
  matchedPairIds.value = []
  moves.value = 0
  seconds.value = 0
  started.value = false
  completed.value = false
  lockBoard.value = false
  memoryLoading.value = false
}

const startTimerIfNeeded = (): void => {
  if (started.value) return
  started.value = true
  timer = setInterval(() => {
    seconds.value += 1
  }, 1000)
}

const isVisible = (index: number): boolean => {
  const card = cards.value[index]
  if (!card) return false
  return openedIndices.value.includes(index) || matchedPairIds.value.includes(card.pairId)
}

const onSelectCard = (index: number): void => {
  if (memoryLoading.value) return
  if (completed.value || lockBoard.value) return
  if (isVisible(index)) return

  startTimerIfNeeded()

  openedIndices.value.push(index)

  if (openedIndices.value.length < 2) return

  moves.value += 1

  const [firstIndex, secondIndex] = openedIndices.value
  if (firstIndex === undefined || secondIndex === undefined) {
    openedIndices.value = []
    return
  }

  const first = cards.value[firstIndex]
  const second = cards.value[secondIndex]
  if (!first || !second) {
    openedIndices.value = []
    return
  }

  if (first.pairId === second.pairId) {
    matchedPairIds.value = [...matchedPairIds.value, first.pairId]
    openedIndices.value = []

    if (matchedPairIds.value.length === sourcePairs.value.length) {
      completed.value = true
      clearTimers()
      progressStore.saveGameRecord(moves.value, seconds.value)
    }
    return
  }

  lockBoard.value = true
  flipBackTimer = setTimeout(() => {
    openedIndices.value = []
    lockBoard.value = false
  }, 650)
}

const bestMoves = computed(() => progressStore.state.game.bestMoves)
const bestSeconds = computed(() => progressStore.state.game.bestSeconds)

onBeforeUnmount(() => {
  clearTimers()
})

void startRound()
</script>

<template>
  <section class="page-card">
    <h2 class="page-title">{{ t('game.title') }}</h2>
    <p class="page-description">{{ t('game.description') }}</p>

    <div class="toolbar" style="margin-bottom: 0.8rem">
      <RouterLink to="/games" class="button ghost">{{ t('gamesHub.backToHub') }}</RouterLink>
      <span class="muted">{{ t('gamesHub.memoryKicker') }}</span>
      <label class="muted" for="memory-category">{{ t('game.category') }}</label>
      <select id="memory-category" v-model="categoryId" class="select" @change="startRound">
        <option :value="ALL_WORD_CATEGORY_ID">{{ t('vocabulary.allCategories') }}</option>
        <option v-for="item in categoryOptions" :key="item.id" :value="item.id">
          {{ item.label }}
        </option>
      </select>
    </div>

    <div class="grid cards-3" style="margin-bottom: 1rem">
      <div class="stat">
        <p class="stat-label">{{ t('game.moves') }}</p>
        <p class="stat-value">{{ moves }}</p>
      </div>
      <div class="stat">
        <p class="stat-label">{{ t('game.time') }}</p>
        <p class="stat-value">{{ started ? `${seconds}s` : '-' }}</p>
      </div>
      <div class="stat">
        <p class="stat-label">{{ t('game.bestMoves') }} / {{ t('game.bestTime') }}</p>
        <p class="stat-value">
          {{ bestMoves || '-' }} / {{ bestSeconds ? `${bestSeconds}s` : '-' }}
        </p>
      </div>
    </div>

    <div class="toolbar" style="margin-bottom: 1rem">
      <button class="button" type="button" @click="startRound">
        {{ t('game.restart') }}
      </button>
      <span class="muted" v-if="memoryLoading">{{ t('game.loadingDeck') }}</span>
      <span class="muted" v-if="!started">{{ t('game.startHint') }}</span>
      <span class="badge" v-if="completed">{{ t('game.complete') }}</span>
    </div>

    <p v-if="memoryLoadFailed" class="empty-state">{{ t('game.loadError') }}</p>

    <div class="memory-board">
      <button
        v-for="(card, index) in cards"
        :key="card.id"
        type="button"
        class="memory-card"
        :class="{ hidden: !isVisible(index) }"
        @click="onSelectCard(index)"
      >
        <template v-if="isVisible(index)">
          {{ card.text }}
        </template>
      </button>
    </div>
  </section>
</template>
