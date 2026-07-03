import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type { PracticeQuestionType, ProgressState, WrongNotebookItem } from '@/types/learning'
import { storage } from '@/utils/storage'

const PROGRESS_KEY = 'study-arcade-progress-v1'

const createInitialState = (): ProgressState => ({
  vocabulary: {
    masteredWordIds: [],
    dailyGoal: 8,
    streakDays: 0,
    lastStudyDate: null,
  },
  practice: {
    totalAnswered: 0,
    correctAnswered: 0,
    wrongNotebook: [],
  },
  game: {
    totalRounds: 0,
    bestMoves: 0,
    bestSeconds: 0,
    reactionBestMs: 0,
    reactionPlays: 0,
    reactionHistory: [],
    guessWins: 0,
    guessBestAttempts: 0,
    popBestScore: 0,
    popPlays: 0,
    memoryNumberBestMs: 0,
    memoryNumberPlays: 0,
    memoryNumberCorrect: 0,
    sequenceBestMs: 0,
    sequencePlays: 0,
    sequenceBestErrors: 999,
    aimTrainBestScore: 0,
    aimTrainPlays: 0,
    shootingBestScore: 0,
    shootingPlays: 0,
  },
  preferences: {
    locale: 'zh-CN',
  },
})

const toSafeInt = (value: unknown, fallback: number, min = 0, max = 999999): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const num = Math.floor(value)
  if (num < min) return min
  if (num > max) return max
  return num
}

const toStringOrNull = (value: unknown): string | null => {
  return typeof value === 'string' && value.length > 0 ? value : null
}

const toPracticeQuestionType = (value: unknown): PracticeQuestionType => {
  return value === 'zhToEnChoice' || value === 'zhToEnInput' ? value : 'enToZhChoice'
}

const normalizeWrongNotebook = (value: unknown): WrongNotebookItem[] => {
  if (!Array.isArray(value)) return []

  const output: WrongNotebookItem[] = []
  const seen = new Set<string>()

  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const raw = item as Partial<WrongNotebookItem>

    const wordId = typeof raw.wordId === 'string' ? raw.wordId.trim() : ''
    const word = typeof raw.word === 'string' ? raw.word.trim() : ''
    const meaning = typeof raw.meaning === 'string' ? raw.meaning.trim() : ''
    const category =
      typeof raw.category === 'string' && raw.category.trim() ? raw.category.trim() : 'unknown'

    if (!wordId || !word || !meaning) continue

    const questionType = toPracticeQuestionType(raw.questionType)
    const stableId =
      typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `${wordId}:${questionType}`
    if (seen.has(stableId)) continue

    seen.add(stableId)
    output.push({
      id: stableId,
      wordId,
      word,
      meaning,
      category,
      questionType,
      wrongCount: toSafeInt(raw.wrongCount, 1, 1, 999999),
      updatedAt: toStringOrNull(raw.updatedAt) ?? new Date().toISOString(),
    })
  }

  return output
}

const normalizeProgressState = (rawValue: unknown): ProgressState => {
  const defaults = createInitialState()
  if (!rawValue || typeof rawValue !== 'object') return defaults

  const raw = rawValue as Partial<ProgressState> & {
    exam?: {
      totalAttempts?: number
      bestScore?: number
      latestScore?: number
    }
  }
  const rawVocabulary = raw.vocabulary ?? defaults.vocabulary
  const rawPractice = raw.practice
  const rawExam = raw.exam
  const legacyTotalAttempts = toSafeInt(rawExam?.totalAttempts, 0)
  const legacyBestScore = toSafeInt(rawExam?.bestScore, 0)
  const legacyLatestScore = toSafeInt(rawExam?.latestScore, 0)
  const rawGame = raw.game ?? defaults.game
  const rawPreferences = raw.preferences ?? defaults.preferences

  return {
    vocabulary: {
      masteredWordIds: Array.isArray(rawVocabulary.masteredWordIds)
        ? rawVocabulary.masteredWordIds.filter((id): id is string => typeof id === 'string')
        : defaults.vocabulary.masteredWordIds,
      dailyGoal: toSafeInt(rawVocabulary.dailyGoal, defaults.vocabulary.dailyGoal, 1, 200),
      streakDays: toSafeInt(rawVocabulary.streakDays, defaults.vocabulary.streakDays),
      lastStudyDate: toStringOrNull(rawVocabulary.lastStudyDate),
    },
    practice: {
      totalAnswered: toSafeInt(
        rawPractice?.totalAnswered,
        Math.max(
          legacyTotalAttempts,
          legacyBestScore,
          legacyLatestScore,
          defaults.practice.totalAnswered,
        ),
      ),
      correctAnswered: toSafeInt(rawPractice?.correctAnswered, defaults.practice.correctAnswered),
      wrongNotebook: normalizeWrongNotebook(rawPractice?.wrongNotebook),
    },
    game: {
      totalRounds: toSafeInt(rawGame.totalRounds, defaults.game.totalRounds),
      bestMoves: toSafeInt(rawGame.bestMoves, defaults.game.bestMoves),
      bestSeconds: toSafeInt(rawGame.bestSeconds, defaults.game.bestSeconds),
      reactionBestMs: toSafeInt(rawGame.reactionBestMs, defaults.game.reactionBestMs),
      reactionPlays: toSafeInt(rawGame.reactionPlays, defaults.game.reactionPlays),
      reactionHistory: Array.isArray(rawGame.reactionHistory)
        ? rawGame.reactionHistory
            .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
            .slice(0, 10)
        : defaults.game.reactionHistory,
      guessWins: toSafeInt(rawGame.guessWins, defaults.game.guessWins),
      guessBestAttempts: toSafeInt(rawGame.guessBestAttempts, defaults.game.guessBestAttempts),
      popBestScore: toSafeInt(rawGame.popBestScore, defaults.game.popBestScore),
      popPlays: toSafeInt(rawGame.popPlays, defaults.game.popPlays),
      memoryNumberBestMs: toSafeInt(rawGame.memoryNumberBestMs, defaults.game.memoryNumberBestMs),
      memoryNumberPlays: toSafeInt(rawGame.memoryNumberPlays, defaults.game.memoryNumberPlays),
      memoryNumberCorrect: toSafeInt(
        rawGame.memoryNumberCorrect,
        defaults.game.memoryNumberCorrect,
      ),
      sequenceBestMs: toSafeInt(rawGame.sequenceBestMs, defaults.game.sequenceBestMs),
      sequencePlays: toSafeInt(rawGame.sequencePlays, defaults.game.sequencePlays),
      sequenceBestErrors: toSafeInt(rawGame.sequenceBestErrors, defaults.game.sequenceBestErrors),
      aimTrainBestScore: toSafeInt(rawGame.aimTrainBestScore, defaults.game.aimTrainBestScore),
      aimTrainPlays: toSafeInt(rawGame.aimTrainPlays, defaults.game.aimTrainPlays),
      shootingBestScore: toSafeInt(rawGame.shootingBestScore, defaults.game.shootingBestScore),
      shootingPlays: toSafeInt(rawGame.shootingPlays, defaults.game.shootingPlays),
    },
    preferences: {
      locale: rawPreferences.locale === 'en' ? 'en' : 'zh-CN',
    },
  }
}

const calcStreak = (lastStudyDate: string | null, nowDate: string): number => {
  if (!lastStudyDate) return 1

  const current = new Date(`${nowDate}T00:00:00`)
  const previous = new Date(`${lastStudyDate}T00:00:00`)
  const oneDayMs = 24 * 60 * 60 * 1000
  const days = Math.round((current.getTime() - previous.getTime()) / oneDayMs)

  if (days <= 0) return 0
  if (days === 1) return 1
  return 0
}

export const useLearningProgressStore = defineStore('learning-progress', () => {
  const state = ref<ProgressState>(
    normalizeProgressState(storage.get<unknown>(PROGRESS_KEY, createInitialState())),
  )

  const masteredCount = computed(() => state.value.vocabulary.masteredWordIds.length)
  const wrongNotebookCount = computed(() => state.value.practice.wrongNotebook.length)
  const practiceAccuracy = computed(() => {
    const total = state.value.practice.totalAnswered
    if (total <= 0) return 0
    return Math.round((state.value.practice.correctAnswered / total) * 100)
  })
  const reactionAverageMs = computed(() => {
    const history = state.value.game.reactionHistory
    if (history.length === 0) return 0
    const sum = history.reduce((acc, val) => acc + val, 0)
    return Math.round(sum / history.length)
  })

  const markWordMastered = (wordId: string): void => {
    const mastered = new Set(state.value.vocabulary.masteredWordIds)
    mastered.add(wordId)
    state.value.vocabulary.masteredWordIds = [...mastered]

    const nowDate = new Date().toISOString().slice(0, 10)
    if (state.value.vocabulary.lastStudyDate !== nowDate) {
      const streakStep = calcStreak(state.value.vocabulary.lastStudyDate, nowDate)
      state.value.vocabulary.streakDays =
        streakStep === 0 ? 1 : state.value.vocabulary.streakDays + streakStep
      state.value.vocabulary.lastStudyDate = nowDate
    }
  }

  const unmarkWordMastered = (wordId: string): void => {
    const mastered = new Set(state.value.vocabulary.masteredWordIds)
    mastered.delete(wordId)
    state.value.vocabulary.masteredWordIds = [...mastered]
  }

  const updateDailyGoal = (goal: number): void => {
    const safeGoal = Number.isFinite(goal) ? Math.max(1, Math.min(goal, 200)) : 8
    state.value.vocabulary.dailyGoal = safeGoal
  }

  const recordPracticeResult = (payload: {
    isCorrect: boolean
    wrongItem?: {
      wordId: string
      word: string
      meaning: string
      category: string
      questionType: PracticeQuestionType
    }
  }): void => {
    state.value.practice.totalAnswered += 1
    if (payload.isCorrect) {
      state.value.practice.correctAnswered += 1
      return
    }

    if (!payload.wrongItem) return

    const normalizedWordId = payload.wrongItem.wordId.trim()
    const normalizedWord = payload.wrongItem.word.trim()
    const normalizedMeaning = payload.wrongItem.meaning.trim()
    const normalizedCategory = payload.wrongItem.category.trim() || 'unknown'

    if (!normalizedWordId || !normalizedWord || !normalizedMeaning) return

    const wrongId = `${normalizedWordId}:${payload.wrongItem.questionType}`
    const now = new Date().toISOString()

    const found = state.value.practice.wrongNotebook.find((item) => item.id === wrongId)
    if (found) {
      found.wrongCount += 1
      found.updatedAt = now
      return
    }

    state.value.practice.wrongNotebook.unshift({
      id: wrongId,
      wordId: normalizedWordId,
      word: normalizedWord,
      meaning: normalizedMeaning,
      category: normalizedCategory,
      questionType: payload.wrongItem.questionType,
      wrongCount: 1,
      updatedAt: now,
    })
  }

  const removeWrongNotebookItem = (itemId: string): void => {
    state.value.practice.wrongNotebook = state.value.practice.wrongNotebook.filter(
      (item) => item.id !== itemId,
    )
  }

  const clearWrongNotebook = (): void => {
    state.value.practice.wrongNotebook = []
  }

  const saveGameRecord = (moves: number, seconds: number): void => {
    state.value.game.totalRounds += 1

    if (state.value.game.bestMoves === 0) {
      state.value.game.bestMoves = moves
    } else {
      state.value.game.bestMoves = Math.min(state.value.game.bestMoves, moves)
    }

    if (state.value.game.bestSeconds === 0) {
      state.value.game.bestSeconds = seconds
    } else {
      state.value.game.bestSeconds = Math.min(state.value.game.bestSeconds, seconds)
    }
  }

  const saveReactionScore = (ms: number): void => {
    const safeMs = Math.max(1, Math.floor(ms))
    state.value.game.reactionPlays += 1

    state.value.game.reactionHistory = [safeMs, ...state.value.game.reactionHistory].slice(0, 10)

    if (state.value.game.reactionBestMs === 0) {
      state.value.game.reactionBestMs = safeMs
    } else {
      state.value.game.reactionBestMs = Math.min(state.value.game.reactionBestMs, safeMs)
    }
  }

  const saveGuessRecord = (attempts: number): void => {
    const safeAttempts = Math.max(1, Math.floor(attempts))
    state.value.game.guessWins += 1

    if (state.value.game.guessBestAttempts === 0) {
      state.value.game.guessBestAttempts = safeAttempts
    } else {
      state.value.game.guessBestAttempts = Math.min(
        state.value.game.guessBestAttempts,
        safeAttempts,
      )
    }
  }

  const savePopRecord = (score: number): void => {
    const safeScore = Math.max(0, Math.floor(score))
    state.value.game.popPlays += 1
    state.value.game.popBestScore = Math.max(state.value.game.popBestScore, safeScore)
  }

  const saveMemoryNumberScore = (ms: number, isCorrect: boolean): void => {
    const safeMs = Math.max(1, Math.floor(ms))
    state.value.game.memoryNumberPlays += 1

    if (isCorrect) {
      state.value.game.memoryNumberCorrect += 1

      if (state.value.game.memoryNumberBestMs === 0) {
        state.value.game.memoryNumberBestMs = safeMs
      } else {
        state.value.game.memoryNumberBestMs = Math.min(state.value.game.memoryNumberBestMs, safeMs)
      }
    }
  }

  const saveSequenceScore = (ms: number, errors: number): void => {
    const safeMs = Math.max(1, Math.floor(ms))
    const safeErrors = Math.max(0, Math.floor(errors))
    state.value.game.sequencePlays += 1

    if (state.value.game.sequenceBestMs === 0) {
      state.value.game.sequenceBestMs = safeMs
    } else {
      state.value.game.sequenceBestMs = Math.min(state.value.game.sequenceBestMs, safeMs)
    }

    state.value.game.sequenceBestErrors = Math.min(state.value.game.sequenceBestErrors, safeErrors)
  }

  const saveAimTrainScore = (score: number): void => {
    const safeScore = Math.max(0, Math.floor(score))
    state.value.game.aimTrainPlays += 1
    state.value.game.aimTrainBestScore = Math.max(state.value.game.aimTrainBestScore, safeScore)
  }

  const saveShootingScore = (score: number): void => {
    const safeScore = Math.max(0, Math.floor(score))
    state.value.game.shootingPlays += 1
    state.value.game.shootingBestScore = Math.max(state.value.game.shootingBestScore, safeScore)
  }

  const setLocale = (locale: 'zh-CN' | 'en'): void => {
    state.value.preferences.locale = locale
  }

  const resetProgress = (): void => {
    state.value = createInitialState()
  }

  watch(
    state,
    (value) => {
      storage.set(PROGRESS_KEY, value)
    },
    { deep: true },
  )

  return {
    state,
    masteredCount,
    wrongNotebookCount,
    practiceAccuracy,
    reactionAverageMs,
    markWordMastered,
    unmarkWordMastered,
    updateDailyGoal,
    recordPracticeResult,
    removeWrongNotebookItem,
    clearWrongNotebook,
    saveGameRecord,
    saveReactionScore,
    saveGuessRecord,
    savePopRecord,
    saveMemoryNumberScore,
    saveSequenceScore,
    saveAimTrainScore,
    saveShootingScore,
    setLocale,
    resetProgress,
  }
})
