import { describe, expect, it } from 'vitest'
import { maskEmail, maskSecret, truncateMiddle } from './mask'

const ASCII_SEQUENCE = 'abcdefghijklmnopqrstuvwxyz0123456789'

const seq = (length: number) =>
  Array.from({ length }, (_, index) => ASCII_SEQUENCE[index % ASCII_SEQUENCE.length]).join('')

describe('maskSecret', () => {
  it('scales the visible window with the value length', () => {
    expect(maskSecret('abcdefghijklmno')).toBe('abcd...lmno')
    expect(maskSecret(seq(24))).toBe('abcde...tuvwx')
    expect(maskSecret(seq(36))).toBe('abcdefg...3456789')
    expect(maskSecret(seq(52))).toBe('abcdefgh...ijklmnop')
    expect(maskSecret(seq(68))).toBe('abcdefgh...yz012345')
  })

  it('falls back to the placeholder below the minimum hidden length', () => {
    expect(maskSecret('abcdefghijklm')).toBe('********')
    expect(maskSecret('abcdefghijklmn')).toBe('********')
    expect(maskSecret('abcdefghijklmno')).toBe('abcd...lmno')
  })

  it('returns the placeholder for empty and nullish values', () => {
    expect(maskSecret('')).toBe('********')
    expect(maskSecret(null)).toBe('********')
    expect(maskSecret(undefined)).toBe('********')
  })

  it('stringifies non-string values', () => {
    expect(maskSecret(12345678901234567890n)).toBe('1234...7890')
    expect(maskSecret(1234567890123456)).toBe('1234...3456')
  })

  it('honours explicit prefix and suffix overrides', () => {
    expect(maskSecret(seq(36), { prefixLength: 6, suffixLength: 4 })).toBe('abcdef...6789')
    expect(maskSecret(seq(36), { prefixLength: 2, suffixLength: 2 })).toBe('ab...89')
  })

  it('honours separator, placeholder and ratio overrides', () => {
    expect(maskSecret(seq(36), { separator: '****' })).toBe('abcdefg****3456789')
    expect(maskSecret('short', { placeholder: '[redacted]' })).toBe('[redacted]')
    expect(maskSecret(seq(68), { visibleRatio: 0.5, maxVisible: 18 })).toBe(
      `${seq(68).slice(0, 18)}...${seq(68).slice(-18)}`,
    )
  })

  it('keeps relay-token and gift-code prefixes readable', () => {
    const relayToken = `rlt_${seq(64)}`
    const maskedToken = maskSecret(relayToken)
    expect(maskedToken.startsWith('rlt_abcd')).toBe(true)
    expect(maskedToken.endsWith(relayToken.slice(-8))).toBe(true)
    expect(maskedToken).not.toContain(relayToken.slice(8, -8))

    expect(maskSecret('ugc_AbCdEfGhIjKlMnOpQrStUvWxYz012345')).toBe('ugc_AbC...z012345')
  })
})

describe('truncateMiddle', () => {
  it('keeps values that already fit', () => {
    expect(truncateMiddle(seq(20), 20)).toBe(seq(20))
    expect(truncateMiddle('short', 20)).toBe('short')
  })

  it('keeps the head and tail for longer values', () => {
    expect(truncateMiddle(seq(21), 20)).toBe('abcdefgh...nopqrstu')
  })

  it('preserves the legacy omitStr boundary behaviour', () => {
    const legacyOmitStr = (str: string, maxLength: number): string => {
      if (str.length <= maxLength) return str
      const half = Math.floor((maxLength - 3) / 2)
      return `${str.slice(0, half)}...${str.slice(str.length - half)}`
    }

    for (const maxLength of [4, 5, 8, 20, 33]) {
      for (const length of [3, 4, 20, 21, 64]) {
        expect(truncateMiddle(seq(length), maxLength)).toBe(legacyOmitStr(seq(length), maxLength))
      }
    }
  })
})

describe('maskEmail', () => {
  it('keeps the domain and two leading name characters', () => {
    expect(maskEmail('zhangsan@example.com')).toBe('zh******@example.com')
    expect(maskEmail('ab@example.com')).toBe('a*@example.com')
    expect(maskEmail('a@example.com')).toBe('a*@example.com')
  })

  it('returns values without a usable domain unchanged', () => {
    expect(maskEmail('not-an-email')).toBe('not-an-email')
    expect(maskEmail('name@')).toBe('name@')
    expect(maskEmail('')).toBe('')
    expect(maskEmail(null)).toBe('')
  })
})
