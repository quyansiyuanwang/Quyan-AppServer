import { describe, expect, it } from 'vitest'
import { validateTwoFactorCode } from '@/utils/validation'

describe('validateTwoFactorCode', () => {
  it('accepts six-digit verification code', () => {
    expect(validateTwoFactorCode('123456')).toBe(true)
  })

  it('rejects non-digit verification code', () => {
    expect(validateTwoFactorCode('12A456')).toBe(false)
  })

  it('accepts recovery code when recovery validation is enabled', () => {
    expect(validateTwoFactorCode('ab12-cd34', true)).toBe(true)
  })

  it('rejects malformed recovery code when recovery validation is enabled', () => {
    expect(validateTwoFactorCode('AB12CD34', true)).toBe(false)
  })
})
