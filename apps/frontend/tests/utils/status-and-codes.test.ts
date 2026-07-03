import { describe, expect, it } from 'vitest'
import { HttpStatusCode } from 'axios'
import { CustomCode } from '@/constant/custom-code'
import { getCustomCodeText, getHttpStatusText } from '@/utils/status-and-codes'

describe('status-and-codes', () => {
  it('maps HTTP status code to status text', () => {
    expect(getHttpStatusText(HttpStatusCode.Ok)).toBe('Ok')
  })

  it('maps custom business code to enum key', () => {
    expect(getCustomCodeText(CustomCode.PERMISSION_DENIED)).toBe('PERMISSION_DENIED')
  })

  it('returns undefined for unknown codes', () => {
    expect(getHttpStatusText(999 as unknown as HttpStatusCode)).toBeUndefined()
    expect(getCustomCodeText(9_999 as unknown as CustomCode)).toBeUndefined()
  })
})
