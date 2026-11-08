import { describe, expect, it } from 'vitest'
import { estimatedAlipayCredit, isAlipayCheckoutUrl, isAlipayPending } from '@/utils/alipay-payment'

describe('Alipay checkout boundaries', () => {
  it('only permits official HTTPS checkout gateways', () => {
    expect(isAlipayCheckoutUrl('https://openapi.alipay.com/gateway.do?sign=fixture')).toBe(true)
    expect(isAlipayCheckoutUrl('https://openapi-sandbox.dl.alipaydev.com/gateway.do')).toBe(true)
    for (const url of [
      'javascript:alert(1)',
      'https://openapi.alipay.com.evil.invalid/gateway.do',
      'http://openapi.alipay.com/gateway.do',
      'https://user:password@openapi.alipay.com/gateway.do',
    ])
      expect(isAlipayCheckoutUrl(url)).toBe(false)
  })
  it('stops automatic refresh for terminal states', () => {
    expect(isAlipayPending('pending')).toBe(true)
    expect(isAlipayPending('refunding')).toBe(true)
    for (const state of ['paid', 'refunded', 'closed']) expect(isAlipayPending(state)).toBe(false)
  })
  it('previews the recharge ratio without accepting exponent amounts', () => {
    expect(estimatedAlipayCredit('0.29', '100')).toBe('29.0000')
    expect(estimatedAlipayCredit('1e2', '100')).toBe('0.0000')
  })
})
