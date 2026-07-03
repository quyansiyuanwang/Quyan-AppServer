import { describe, expect, it } from 'vitest'
import { shuffle } from '@/utils/shuffle'

describe('shuffle', () => {
  it('returns same elements with same length', () => {
    const input = [1, 2, 3, 4, 5, 6]
    const output = shuffle(input)

    expect(output).toHaveLength(input.length)
    expect([...output].sort()).toEqual([...input].sort())
  })

  it('does not mutate the original array', () => {
    const input = ['a', 'b', 'c']
    const snapshot = [...input]

    shuffle(input)

    expect(input).toEqual(snapshot)
  })
})
