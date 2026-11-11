import { describe, expect, it } from 'vitest'
import {
  estimatedAlipayCredit,
  isAlipayAmountInRange,
  isAlipayCheckoutUrl,
  isAlipayPending,
  normalizeAlipayAmount,
} from '@/utils/alipay-payment'

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
  it('trims decimal amounts without rounding or accepting invalid input', () => {
    expect(normalizeAlipayAmount(' 0.01 ')).toBe('0.01')
    expect(normalizeAlipayAmount('5')).toBe('5')
    for (const input of ['', ' ', '0', '0.00', '-1', '1e2', '0.001', '01', '1.', '100000000']) {
      expect(normalizeAlipayAmount(input)).toBeUndefined()
      expect(estimatedAlipayCredit(input, '100')).toBe('0.0000')
    }
    expect(estimatedAlipayCredit(' 0.29 ', '100')).toBe('29.0000')
  })
  it('checks configured limits in exact cents, including both boundaries', () => {
    for (const input of ['0.01', '0.29', '10.00'])
      expect(isAlipayAmountInRange(input, '0.01', '10.00')).toBe(true)
    for (const input of ['', '0.001', '10.01', '99999999'])
      expect(isAlipayAmountInRange(input, '0.01', '10.00')).toBe(false)
    expect(isAlipayAmountInRange('0.99', '1.00', '10.00')).toBe(false)
    expect(isAlipayAmountInRange('1.00', '', '10.00')).toBe(false)
  })
})
