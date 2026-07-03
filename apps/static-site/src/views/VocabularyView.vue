<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  ALL_WORD_CATEGORY_ID,
  getVocabularyWordsChunkByCategory,
  getVocabularyWordsByCategory,
  listWordCategories,
} from '@/data/vocabulary'
import { shuffle } from '@/utils/shuffle'
import { useLearningProgressStore } from '@/stores/learningProgress'
import type { PracticeQuestionType, VocabularyWord, WrongNotebookItem } from '@/types/learning'

type VocabularyMode = 'memory' | 'practice'
type PracticeSource = 'normal' | 'wrongNotebook'

interface PracticeChoice {
  id: string
  label: string
  isCorrect: boolean
}

interface PracticeQuestion {
  id: string
  type: PracticeQuestionType
  word: VocabularyWord
  prompt: string
  choices: PracticeChoice[]
  wrongNotebookItemId?: string
}

const { t } = useI18n()
const route = useRoute()
const progressStore = useLearningProgressStore()

const pageSize = 20
const initialCategoryId = listWordCategories()[0]?.id ?? ALL_WORD_CATEGORY_ID

const routeMode = typeof route.query.mode === 'string' ? route.query.mode : ''
const initialMode: VocabularyMode = routeMode === 'practice' ? 'practice' : 'memory'

const categoryId = ref(initialCategoryId)
const mode = ref<VocabularyMode>(initialMode)
const memoryRequestedCount = ref(pageSize)
const memoryWords = ref<VocabularyWord[]>([])
const memoryTotal = ref(0)
const memoryHasMore = ref(false)
const memoryLoading = ref(false)
const memoryLoadFailed = ref(false)
const memoryRequestId = ref(0)
const hideMemoryMastered = ref(false)
const showOnlyMastered = ref(false)

const practiceSource = ref<PracticeSource>('normal')
const practiceQuestion = ref<PracticeQuestion | null>(null)
const practiceAnswered = ref(false)
const practiceIsCorrect = ref(false)
const selectedChoiceId = ref('')
const inputAnswer = ref('')
const practiceMessage = ref('')
const practiceLoading = ref(false)
const practiceRequestId = ref(0)

const categories = computed(() => listWordCategories())

const wrongNotebookItems = computed<WrongNotebookItem[]>(() => {
  const scoped =
    categoryId.value === ALL_WORD_CATEGORY_ID
      ? progressStore.state.practice.wrongNotebook
      : progressStore.state.practice.wrongNotebook.filter(
          (item) => item.category === categoryId.value,
        )

  return [...scoped].sort((a, b) => {
    if (b.wrongCount !== a.wrongCount) return b.wrongCount - a.wrongCount
    return b.updatedAt.localeCompare(a.updatedAt)
  })
})

const wrongNotebookPool = computed<VocabularyWord[]>(() => {
  const deduped = new Map<string, VocabularyWord>()

  for (const item of wrongNotebookItems.value) {
    if (deduped.has(item.wordId)) continue
    deduped.set(item.wordId, {
      id: item.wordId,
      word: item.word,
      meaning: item.meaning,
      phonetic: '',
      category: item.category,
    })
  }

  return [...deduped.values()]
})

const practicePool = computed<VocabularyWord[]>(() => {
  return practiceSource.value === 'wrongNotebook' ? wrongNotebookPool.value : memoryWords.value
})

const currentTotal = computed(() => {
  return memoryTotal.value
})

const visibleMemoryWords = computed(() => {
  if (showOnlyMastered.value) {
    return memoryWords.value.filter((word) => masteredSet.value.has(word.id))
  }
  if (hideMemoryMastered.value) {
    return memoryWords.value.filter((word) => !masteredSet.value.has(word.id))
  }
  return memoryWords.value
})
const canLoadMore = computed(() => memoryHasMore.value)

const masteredSet = computed(() => new Set(progressStore.state.vocabulary.masteredWordIds))
const dailyGoal = computed({
  get: () => progressStore.state.vocabulary.dailyGoal,
  set: (value: number) => progressStore.updateDailyGoal(value),
})

const practiceTotal = computed(() => progressStore.state.practice.totalAnswered)
const practiceCorrect = computed(() => progressStore.state.practice.correctAnswered)
const practiceAccuracy = computed(() => progressStore.practiceAccuracy)
const wrongNotebookCount = computed(() => wrongNotebookItems.value.length)

const normalizeAnswer = (value: string): string => {
  return value.trim().toLowerCase()
}

const getPracticeTypeLabel = (type: PracticeQuestionType): string => {
  if (type === 'zhToEnChoice') return t('vocabulary.practiceTypeZhToEnChoice')
  if (type === 'zhToEnInput') return t('vocabulary.practiceTypeZhToEnInput')
  return t('vocabulary.practiceTypeEnToZhChoice')
}

const chooseRandomWord = (pool: VocabularyWord[]): VocabularyWord => {
  const index = Math.floor(Math.random() * pool.length)
  return pool[index] ?? pool[0]!
}

const createChoiceQuestion = (
  word: VocabularyWord,
  pool: VocabularyWord[],
  type: 'enToZhChoice' | 'zhToEnChoice',
  wrongNotebookItemId?: string,
): PracticeQuestion | null => {
  const distractors = shuffle(pool.filter((item) => item.id !== word.id)).slice(0, 3)
  if (distractors.length === 0) return null

  const correctLabel = type === 'enToZhChoice' ? word.meaning : word.word
  const distractorChoices = distractors.map<PracticeChoice>((item) => ({
    id: item.id,
    label: type === 'enToZhChoice' ? item.meaning : item.word,
    isCorrect: false,
  }))

  const choices = shuffle<PracticeChoice>([
    ...distractorChoices,
    {
      id: word.id,
      label: correctLabel,
      isCorrect: true,
    },
  ])

  return {
    id: `${word.id}:${type}:${Date.now()}`,
    type,
    word,
    prompt: type === 'enToZhChoice' ? word.word : word.meaning,
    choices,
    wrongNotebookItemId,
  }
}

const createInputQuestion = (
  word: VocabularyWord,
  wrongNotebookItemId?: string,
): PracticeQuestion => {
  return {
    id: `${word.id}:zhToEnInput:${Date.now()}`,
    type: 'zhToEnInput',
    word,
    prompt: word.meaning,
    choices: [],
    wrongNotebookItemId,
  }
}

const createPracticeQuestion = (pool: VocabularyWord[]): PracticeQuestion | null => {
  if (pool.length === 0) return null

  const word = chooseRandomWord(pool)
  const typeCandidates = shuffle<PracticeQuestionType>([
    'enToZhChoice',
    'zhToEnChoice',
    'zhToEnInput',
  ])

  for (const type of typeCandidates) {
    if (type === 'zhToEnInput') {
      return createInputQuestion(word)
    }

    const question = createChoiceQuestion(word, pool, type)
    if (question) return question
  }

  return createInputQuestion(word)
}

const createWrongNotebookQuestion = (pool: VocabularyWord[]): PracticeQuestion | null => {
  if (wrongNotebookItems.value.length === 0) return null

  const randomIndex = Math.floor(Math.random() * wrongNotebookItems.value.length)
  const notebookItem = wrongNotebookItems.value[randomIndex]
  if (!notebookItem) return null

  const word = pool.find((item) => item.id === notebookItem.wordId) ?? {
    id: notebookItem.wordId,
    word: notebookItem.word,
    meaning: notebookItem.meaning,
    phonetic: '',
    category: notebookItem.category,
  }

  if (notebookItem.questionType === 'zhToEnInput') {
    return createInputQuestion(word, notebookItem.id)
  }

  const question = createChoiceQuestion(word, pool, notebookItem.questionType, notebookItem.id)

  if (question) return question
  return createInputQuestion(word, notebookItem.id)
}

const resetPracticeAnswerState = (): void => {
  practiceAnswered.value = false
  practiceIsCorrect.value = false
  selectedChoiceId.value = ''
  inputAnswer.value = ''
  practiceMessage.value = ''
}

const resolvePracticePool = async (): Promise<VocabularyWord[]> => {
  if (practiceSource.value === 'wrongNotebook') {
    practiceRequestId.value += 1
    practiceLoading.value = false
    return wrongNotebookPool.value
  }

  const requestId = practiceRequestId.value + 1
  practiceRequestId.value = requestId
  practiceLoading.value = true

  try {
    const words = await getVocabularyWordsByCategory(categoryId.value)
    if (requestId !== practiceRequestId.value) return []
    return words
  } catch {
    if (requestId !== practiceRequestId.value) return []
    return []
  } finally {
    if (requestId === practiceRequestId.value) {
      practiceLoading.value = false
    }
  }
}

const loadMemoryWords = async (): Promise<void> => {
  const requestId = memoryRequestId.value + 1
  memoryRequestId.value = requestId

  memoryLoading.value = true
  memoryLoadFailed.value = false
  memoryWords.value = []

  try {
    const result = await getVocabularyWordsChunkByCategory(
      categoryId.value,
      memoryRequestedCount.value,
    )

    if (requestId !== memoryRequestId.value) return
    memoryWords.value = result.words
    memoryTotal.value = result.total
    memoryHasMore.value = result.hasMore

    if (mode.value === 'practice' && practiceSource.value === 'normal' && !practiceQuestion.value) {
      void nextPracticeQuestion()
    }
  } catch {
    if (requestId !== memoryRequestId.value) return
    memoryWords.value = []
    memoryTotal.value = 0
    memoryHasMore.value = false
    memoryLoadFailed.value = true
  } finally {
    if (requestId === memoryRequestId.value) {
      memoryLoading.value = false
    }
  }
}

const markAsMastered = (wordId: string): void => {
  progressStore.markWordMastered(wordId)
}

const unmarkAsMastered = (wordId: string): void => {
  progressStore.unmarkWordMastered(wordId)
}

const nextPracticeQuestion = async (): Promise<void> => {
  const pool = await resolvePracticePool()
  practiceQuestion.value =
    practiceSource.value === 'wrongNotebook'
      ? createWrongNotebookQuestion(pool)
      : createPracticeQuestion(pool)
  resetPracticeAnswerState()
}

const nextWrongNotebookQuestion = (): void => {
  practiceQuestion.value = createWrongNotebookQuestion(wrongNotebookPool.value)
  resetPracticeAnswerState()
}

const submitPracticeAnswer = (): void => {
  if (!practiceQuestion.value || practiceAnswered.value) return

  const question = practiceQuestion.value
  let isCorrect = false

  if (question.type === 'zhToEnInput') {
    const value = normalizeAnswer(inputAnswer.value)
    if (!value) {
      practiceMessage.value = t('vocabulary.practiceInputRequired')
      return
    }

    isCorrect = value === normalizeAnswer(question.word.word)
  } else {
    const selected = question.choices.find((choice) => choice.id === selectedChoiceId.value)
    if (!selected) {
      practiceMessage.value = t('vocabulary.practiceSelectRequired')
      return
    }

    isCorrect = selected.isCorrect
  }

  practiceAnswered.value = true
  practiceIsCorrect.value = isCorrect

  progressStore.recordPracticeResult({
    isCorrect,
    wrongItem: isCorrect
      ? undefined
      : {
          wordId: question.word.id,
          word: question.word.word,
          meaning: question.word.meaning,
          category: question.word.category,
          questionType: question.type,
        },
  })

  if (isCorrect) {
    progressStore.markWordMastered(question.word.id)
    const wrongItemId = question.wrongNotebookItemId ?? `${question.word.id}:${question.type}`
    progressStore.removeWrongNotebookItem(wrongItemId)

    if (practiceSource.value === 'wrongNotebook') {
      nextWrongNotebookQuestion()
      return
    }

    practiceMessage.value = t('vocabulary.practiceCorrect')
    return
  }

  const answer = question.type === 'enToZhChoice' ? question.word.meaning : question.word.word
  practiceMessage.value = `${t('vocabulary.practiceWrong')} ${t('vocabulary.practiceCorrectAnswer')}: ${answer}`
}

const removeWrongNotebookItem = (itemId: string): void => {
  progressStore.removeWrongNotebookItem(itemId)

  if (practiceSource.value === 'wrongNotebook' && practicePool.value.length === 0) {
    practiceQuestion.value = null
    resetPracticeAnswerState()
  }
}

const clearWrongNotebook = (): void => {
  progressStore.clearWrongNotebook()

  if (practiceSource.value === 'wrongNotebook') {
    practiceQuestion.value = null
    resetPracticeAnswerState()
  }
}

const loadMore = (): void => {
  if (mode.value !== 'memory') return
  if (memoryLoading.value || !memoryHasMore.value) return
  memoryRequestedCount.value += pageSize
  void loadMemoryWords()
}

watch(mode, () => {
  if (mode.value === 'practice' && !practiceQuestion.value) {
    void nextPracticeQuestion()
  }
})

watch(practiceSource, () => {
  void nextPracticeQuestion()
})

watch(
  categoryId,
  () => {
    memoryRequestedCount.value = pageSize
    practiceQuestion.value = null
    practiceRequestId.value += 1
    practiceLoading.value = false
    resetPracticeAnswerState()
    void loadMemoryWords()
  },
  { immediate: true },
)
</script>

<template>
  <section class="page-card">
    <h2 class="page-title">{{ t('vocabulary.title') }}</h2>
    <p class="page-description">{{ t('vocabulary.description') }}</p>

    <div class="toolbar" style="margin-bottom: 0.8rem">
      <RouterLink to="/learning" class="button ghost">{{ t('learningHub.title') }}</RouterLink>

      <label class="muted" for="vocabulary-category">{{ t('vocabulary.category') }}</label>
      <select id="vocabulary-category" v-model="categoryId" class="select">
        <option :value="ALL_WORD_CATEGORY_ID">{{ t('vocabulary.allCategories') }}</option>
        <option v-for="item in categories" :key="item.id" :value="item.id">
          {{ item.label }}
        </option>
      </select>

      <div class="segmented">
        <button
          type="button"
          class="button"
          :class="{ primary: mode === 'memory' }"
          @click="mode = 'memory'"
        >
          {{ t('vocabulary.modeMemory') }}
        </button>
        <button
          type="button"
          class="button"
          :class="{ primary: mode === 'practice' }"
          @click="mode = 'practice'"
        >
          {{ t('vocabulary.modePractice') }}
        </button>
      </div>

      <div v-if="mode === 'memory'" class="segmented" style="margin-top: 0.5rem">
        <button
          type="button"
          class="button"
          :class="{ primary: !hideMemoryMastered && !showOnlyMastered }"
          @click="
            () => {
              hideMemoryMastered = false
              showOnlyMastered = false
            }
          "
        >
          {{ t('vocabulary.showAll') }}
        </button>
        <button
          type="button"
          class="button"
          :class="{ primary: hideMemoryMastered }"
          @click="
            () => {
              hideMemoryMastered = true
              showOnlyMastered = false
            }
          "
        >
          {{ t('vocabulary.hideMemoryMastered') }}
        </button>
        <button
          type="button"
          class="button"
          :class="{ primary: showOnlyMastered }"
          @click="
            () => {
              hideMemoryMastered = false
              showOnlyMastered = true
            }
          "
        >
          {{ t('vocabulary.showOnlyMastered') }}
        </button>
      </div>
    </div>

    <div class="grid cards-3" style="margin-bottom: 1rem">
      <div class="stat">
        <p class="stat-label">{{ t('vocabulary.dailyGoal') }}</p>
        <input v-model.number="dailyGoal" class="input" type="number" min="1" max="200" />
      </div>
      <div class="stat">
        <p class="stat-label">{{ t('vocabulary.total') }}</p>
        <p class="stat-value">{{ currentTotal }}</p>
      </div>
      <div class="stat">
        <p class="stat-label">{{ t('vocabulary.streak') }}</p>
        <p class="stat-value">{{ progressStore.state.vocabulary.streakDays }}</p>
      </div>
    </div>

    <p v-if="mode === 'memory' && memoryLoading" class="muted">{{ t('vocabulary.loading') }}</p>
    <p v-else-if="mode === 'memory' && memoryLoadFailed" class="empty-state">
      {{ t('vocabulary.loadError') }}
    </p>
    <p v-else-if="mode === 'memory' && currentTotal === 0" class="empty-state">
      {{ t('vocabulary.noData') }}
    </p>

    <div v-if="mode === 'memory'" class="word-list">
      <article v-for="word in visibleMemoryWords" :key="word.id" class="word-item">
        <div class="word-meta">
          <h3 class="word-name">{{ word.word }}</h3>
          <span class="muted">{{ word.phonetic }}</span>
          <span class="muted" v-if="word.partOfSpeech">{{ word.partOfSpeech }}</span>
          <span class="badge" v-if="masteredSet.has(word.id)">{{
            t('vocabulary.masteredTag')
          }}</span>
        </div>

        <p style="margin: 0.35rem 0">
          <strong>{{ t('vocabulary.cardMeaning') }}:</strong> {{ word.meaning }}
        </p>
        <p v-if="word.example" style="margin: 0.35rem 0">
          <strong>{{ t('vocabulary.cardExample') }}:</strong> {{ word.example }}
        </p>

        <p v-if="word.rawLine" style="margin: 0.35rem 0" class="muted">
          <strong>{{ t('vocabulary.cardRaw') }}:</strong> {{ word.rawLine }}
        </p>

        <div style="display: flex; gap: 0.5rem; flex-wrap: wrap">
          <button
            v-if="!masteredSet.has(word.id)"
            class="button primary"
            type="button"
            @click="markAsMastered(word.id)"
          >
            {{ t('vocabulary.mastered') }}
          </button>
          <button v-else class="button" type="button" @click="unmarkAsMastered(word.id)">
            {{ t('vocabulary.unmarkMastered') }}
          </button>
        </div>
      </article>
    </div>

    <div v-else class="grid" style="gap: 1rem">
      <div class="grid cards-3">
        <div class="stat">
          <p class="stat-label">{{ t('vocabulary.practiceTotal') }}</p>
          <p class="stat-value">{{ practiceTotal }}</p>
        </div>
        <div class="stat">
          <p class="stat-label">{{ t('vocabulary.practiceCorrectCount') }}</p>
          <p class="stat-value">{{ practiceCorrect }}</p>
        </div>
        <div class="stat">
          <p class="stat-label">{{ t('vocabulary.practiceAccuracy') }}</p>
          <p class="stat-value">{{ practiceAccuracy }}%</p>
        </div>
      </div>

      <div class="toolbar">
        <span class="muted">{{ t('vocabulary.practiceSourceLabel') }}</span>
        <button
          type="button"
          class="button"
          :class="{ primary: practiceSource === 'normal' }"
          @click="practiceSource = 'normal'"
        >
          {{ t('vocabulary.practiceSourceNormal') }}
        </button>
        <button
          type="button"
          class="button"
          :class="{ primary: practiceSource === 'wrongNotebook' }"
          @click="practiceSource = 'wrongNotebook'"
        >
          {{ t('vocabulary.practiceSourceWrongNotebook') }} ({{ wrongNotebookCount }})
        </button>
      </div>

      <article class="question-item" v-if="practiceQuestion">
        <div class="question-meta">
          <strong>{{ t('vocabulary.practiceQuestion') }}</strong>
          <span class="badge">{{ getPracticeTypeLabel(practiceQuestion.type) }}</span>
        </div>

        <p style="margin: 0.4rem 0 0.7rem">
          <strong>{{ t('vocabulary.practicePrompt') }}:</strong> {{ practiceQuestion.prompt }}
        </p>

        <div v-if="practiceQuestion.type === 'zhToEnInput'">
          <input
            v-model="inputAnswer"
            class="input"
            type="text"
            :placeholder="t('vocabulary.practiceInputPlaceholder')"
            :disabled="practiceAnswered"
            style="width: min(100%, 360px)"
          />
        </div>

        <div v-else>
          <label
            v-for="choice in practiceQuestion.choices"
            :key="choice.id"
            class="option"
            :class="{
              correct: practiceAnswered && choice.isCorrect,
              wrong: practiceAnswered && !choice.isCorrect && selectedChoiceId === choice.id,
            }"
          >
            <input
              v-model="selectedChoiceId"
              type="radio"
              :name="practiceQuestion.id"
              :value="choice.id"
              :disabled="practiceAnswered"
            />
            {{ choice.label }}
          </label>
        </div>

        <div class="toolbar" style="margin-top: 0.85rem">
          <button
            class="button primary"
            type="button"
            :disabled="practiceAnswered || practiceLoading"
            @click="submitPracticeAnswer"
          >
            {{ t('vocabulary.practiceSubmit') }}
          </button>
          <button
            class="button"
            type="button"
            :disabled="practiceLoading"
            @click="nextPracticeQuestion"
          >
            {{ t('vocabulary.practiceNext') }}
          </button>
          <span class="muted" v-if="practiceLoading">{{ t('vocabulary.loading') }}</span>
          <span class="badge" v-if="practiceAnswered && practiceIsCorrect">{{
            t('vocabulary.practiceCorrect')
          }}</span>
          <span class="muted" v-if="practiceMessage">{{ practiceMessage }}</span>
        </div>
      </article>

      <p v-else class="empty-state">{{ t('vocabulary.practiceNoQuestion') }}</p>

      <article class="feature-card" v-if="practiceSource !== 'wrongNotebook'">
        <div class="toolbar" style="justify-content: space-between; width: 100%">
          <strong>{{ t('vocabulary.wrongNotebookTitle') }}</strong>
          <button
            class="button ghost"
            type="button"
            :disabled="wrongNotebookItems.length === 0"
            @click="clearWrongNotebook"
          >
            {{ t('vocabulary.clearWrongNotebook') }}
          </button>
        </div>

        <p v-if="wrongNotebookItems.length === 0" class="empty-state" style="margin-top: 0.75rem">
          {{ t('vocabulary.wrongNotebookEmpty') }}
        </p>

        <div v-else class="word-list" style="margin-top: 0.75rem">
          <article v-for="item in wrongNotebookItems" :key="item.id" class="word-item">
            <div class="word-meta">
              <h3 class="word-name">{{ item.word }}</h3>
              <span class="badge">{{ getPracticeTypeLabel(item.questionType) }}</span>
              <span class="muted">{{ t('vocabulary.wrongCount') }}: {{ item.wrongCount }}</span>
            </div>

            <p style="margin: 0.35rem 0">
              <strong>{{ t('vocabulary.cardMeaning') }}:</strong> {{ item.meaning }}
            </p>

            <div class="toolbar" style="margin-top: 0.35rem">
              <button class="button ghost" type="button" @click="removeWrongNotebookItem(item.id)">
                {{ t('vocabulary.removeWrongItem') }}
              </button>
            </div>
          </article>
        </div>
      </article>
    </div>

    <div class="toolbar" style="margin-top: 1rem" v-if="mode === 'memory' && canLoadMore">
      <button type="button" class="button" @click="loadMore">
        {{ t('vocabulary.loadMore') }}
      </button>
    </div>
  </section>
</template>
