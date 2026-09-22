import { describe, expect, it } from 'vitest'
import { CustomCode } from '@/constant/custom-code'
import { i18ns } from '@/locales'
import { checkApiResult } from '@/utils/service-utils'

describe('checkApiResult', () => {
  it('accepts an empty successful response for a void operation', () => {
    expect(checkApiResult(undefined, false)).toBeUndefined()
    expect(checkApiResult(null, false)).toBeNull()
    expect(checkApiResult('', false)).toBe('')
  })

  it('still rejects an empty response when the caller requires data', () => {
    // 兜底文案来自 i18n，不写死某一种语言的字面量，避免语言变更后测试失真
    expect(() => checkApiResult(undefined, true)).toThrow(i18ns.t('requestErrors.failed'))
  })

  it('keeps API business failures as failures', () => {
    expect(() =>
      checkApiResult({ code: CustomCode.VALIDATION_FAILED, message: 'invalid' }, false),
    ).toThrow('invalid')
  })
})
