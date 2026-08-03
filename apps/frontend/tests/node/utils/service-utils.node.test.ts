import { describe, expect, it } from 'vitest'
import { CustomCode } from '@/constant/custom-code'
import { checkApiResult } from '@/utils/service-utils'

describe('checkApiResult', () => {
  it('accepts an empty successful response for a void operation', () => {
    expect(checkApiResult(undefined, false)).toBeUndefined()
    expect(checkApiResult(null, false)).toBeNull()
    expect(checkApiResult('', false)).toBe('')
  })

  it('still rejects an empty response when the caller requires data', () => {
    expect(() => checkApiResult(undefined, true)).toThrow('Unknown error')
  })

  it('keeps API business failures as failures', () => {
    expect(() => checkApiResult({ code: CustomCode.VALIDATION_FAILED, message: 'invalid' }, false)).toThrow(
      'invalid',
    )
  })
})
