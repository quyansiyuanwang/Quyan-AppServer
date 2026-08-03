import { describe, expect, it } from 'vitest'
import { deepEqual, getNonEmptyFields, getObjectDiff } from '@/utils/objectDiff'

describe('object diff utils', () => {
  it('returns changed fields and skips undefined values', () => {
    const original = {
      name: 'alice',
      age: 18,
      role: 'user',
    }

    const current = {
      name: 'alice',
      age: 19,
      role: undefined,
      nickname: 'ali',
    }

    expect(getObjectDiff(original, current)).toEqual({
      age: 19,
      nickname: 'ali',
    })
  })

  it('detects array and nested object changes', () => {
    const original = {
      tags: ['a', 'b'],
      profile: { city: 'shenzhen', active: true },
    }

    const changed = {
      tags: ['a', 'b', 'c'],
      profile: { city: 'shenzhen', active: false },
    }

    expect(getObjectDiff(original, changed)).toEqual(changed)
  })

  it('skips unchanged arrays and nested objects', () => {
    const original = {
      tags: ['a', 'b'],
      profile: { city: 'shenzhen', active: true },
      name: 'alice',
    }

    const current = {
      tags: ['a', 'b'],
      profile: { city: 'shenzhen', active: true },
      name: 'alice',
    }

    expect(getObjectDiff(original, current)).toEqual({})
  })

  it('deepEqual compares nested objects and arrays', () => {
    expect(deepEqual({ a: 1, b: { c: [1, 2] } }, { a: 1, b: { c: [1, 2] } })).toBe(true)
    expect(deepEqual({ a: 1, b: { c: [1, 2] } }, { a: 1, b: { c: [2, 1] } })).toBe(false)
  })

  it('deepEqual handles null/type/key-shape edge cases', () => {
    expect(deepEqual(null, null)).toBe(true)
    expect(deepEqual(null, {})).toBe(false)
    expect(deepEqual(1, '1')).toBe(false)
    expect(deepEqual([1, 2], { 0: 1, 1: 2, length: 2 } as any)).toBe(false)
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false)
    expect(deepEqual({ a: 1 }, { b: 1 })).toBe(false)
  })

  it('getNonEmptyFields removes nullish and empty strings', () => {
    const input = {
      title: 'admin',
      count: 0,
      enabled: false,
      empty: '',
      nothing: null,
      skip: undefined,
    }

    expect(getNonEmptyFields(input)).toEqual({
      title: 'admin',
      count: 0,
      enabled: false,
    })
  })
})
