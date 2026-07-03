import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useLearningProgressStore } from '@/stores/learningProgress'

describe('learning progress store', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('records mastered words uniquely', () => {
    const store = useLearningProgressStore()

    store.markWordMastered('resilient')
    store.markWordMastered('resilient')

    expect(store.state.vocabulary.masteredWordIds).toEqual(['resilient'])
    expect(store.masteredCount).toBe(1)
  })

  it('records one-question practice results and wrong notebook entries', () => {
    const store = useLearningProgressStore()

    store.recordPracticeResult({ isCorrect: true })
    store.recordPracticeResult({
      isCorrect: false,
      wrongItem: {
        wordId: 'cet4-abandon',
        word: 'abandon',
        meaning: '放弃',
        category: 'cet4',
        questionType: 'enToZhChoice',
      },
    })
    store.recordPracticeResult({
      isCorrect: false,
      wrongItem: {
        wordId: 'cet4-abandon',
        word: 'abandon',
        meaning: '放弃',
        category: 'cet4',
        questionType: 'enToZhChoice',
      },
    })

    expect(store.state.practice.totalAnswered).toBe(3)
    expect(store.state.practice.correctAnswered).toBe(1)
    expect(store.practiceAccuracy).toBe(33)
    expect(store.state.practice.wrongNotebook).toHaveLength(1)
    expect(store.state.practice.wrongNotebook[0]?.wrongCount).toBe(2)
  })

  it('resets all progress data', () => {
    const store = useLearningProgressStore()

    store.markWordMastered('resilient')
    store.recordPracticeResult({ isCorrect: true })
    store.resetProgress()

    expect(store.state.vocabulary.masteredWordIds).toEqual([])
    expect(store.state.practice.totalAnswered).toBe(0)
    expect(store.state.game.totalRounds).toBe(0)
  })

  it('records independent mini game stats', () => {
    const store = useLearningProgressStore()

    store.saveReactionScore(320)
    store.saveReactionScore(290)
    store.saveGuessRecord(6)
    store.saveGuessRecord(4)
    store.savePopRecord(1200)
    store.savePopRecord(980)

    expect(store.state.game.reactionPlays).toBe(2)
    expect(store.state.game.reactionBestMs).toBe(290)
    expect(store.state.game.guessWins).toBe(2)
    expect(store.state.game.guessBestAttempts).toBe(4)
    expect(store.state.game.popPlays).toBe(2)
    expect(store.state.game.popBestScore).toBe(1200)
  })

  it('supports legacy localStorage state when recording new challenge scores', () => {
    localStorage.setItem(
      'study-arcade-progress-v1',
      JSON.stringify({
        vocabulary: {
          masteredWordIds: ['legacy-word'],
          dailyGoal: 10,
          streakDays: 2,
          lastStudyDate: null,
        },
        exam: {
          totalAttempts: 1,
          bestScore: 3,
          latestScore: 3,
        },
        game: {
          totalRounds: 1,
          bestMoves: 8,
          bestSeconds: 22,
        },
        preferences: {
          locale: 'zh-CN',
        },
      }),
    )

    const store = useLearningProgressStore()
    store.recordPracticeResult({ isCorrect: true })
    store.saveReactionScore(280)
    store.saveGuessRecord(5)
    store.savePopRecord(700)

    expect(store.state.practice.totalAnswered).toBe(4)
    expect(store.state.practice.correctAnswered).toBe(1)
    expect(store.state.game.reactionPlays).toBe(1)
    expect(store.state.game.reactionBestMs).toBe(280)
    expect(store.state.game.guessWins).toBe(1)
    expect(store.state.game.guessBestAttempts).toBe(5)
    expect(store.state.game.popPlays).toBe(1)
    expect(store.state.game.popBestScore).toBe(700)
  })

  it('removes and clears wrong notebook entries', () => {
    const store = useLearningProgressStore()

    store.recordPracticeResult({
      isCorrect: false,
      wrongItem: {
        wordId: 'cet4-abandon',
        word: 'abandon',
        meaning: '放弃',
        category: 'cet4',
        questionType: 'enToZhChoice',
      },
    })
    store.recordPracticeResult({
      isCorrect: false,
      wrongItem: {
        wordId: 'cet4-above',
        word: 'above',
        meaning: '在...之上',
        category: 'cet4',
        questionType: 'zhToEnInput',
      },
    })

    const firstId = store.state.practice.wrongNotebook[0]?.id
    expect(firstId).toBeTruthy()

    if (firstId) {
      store.removeWrongNotebookItem(firstId)
    }

    expect(store.state.practice.wrongNotebook).toHaveLength(1)

    store.clearWrongNotebook()
    expect(store.state.practice.wrongNotebook).toHaveLength(0)
  })
})
