import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  ALL_WORD_CATEGORY_ID,
  getPracticeQuestionsByCategory,
  getVocabularyWordsChunkByCategory,
  getVocabularyWordsByCategory,
  listWordCategories,
} from '@/data/wordbank'

beforeAll(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const target = String(input)

      if (target.includes('wordbank/cet4/memory.txt')) {
        return new Response('abandon /əˈbændən/ vt. 丢弃\nability /əˈbɪləti/ n. 能力', {
          status: 200,
        })
      }

      if (target.includes('wordbank/cet6/memory.txt')) {
        return new Response('meticulous /məˈtɪkjələs/ adj. 一丝不苟的', { status: 200 })
      }

      return new Response('', { status: 404 })
    }),
  )
})

afterAll(() => {
  vi.unstubAllGlobals()
})

describe('wordbank data architecture', () => {
  it('returns category metadata', () => {
    const categories = listWordCategories()

    expect(categories.length).toBeGreaterThan(0)
    expect(categories.some((item) => item.id === 'cet4')).toBe(true)
  })

  it('supports all-category aggregation', async () => {
    const words = await getVocabularyWordsByCategory(ALL_WORD_CATEGORY_ID)
    const questions = getPracticeQuestionsByCategory(ALL_WORD_CATEGORY_ID)

    expect(words.length).toBeGreaterThan(0)
    expect(questions.length).toBeGreaterThan(0)
  })

  it('supports chunked memory loading for incremental pages', async () => {
    const chunk = await getVocabularyWordsChunkByCategory('cet4', 1)

    expect(chunk.words.length).toBe(1)
    expect(chunk.total).toBeGreaterThan(1)
    expect(chunk.hasMore).toBe(true)
  })
})
