export const ALIPAY_POLL_POLICY = Object.freeze({ intervalMs: 5000, maxAttempts: 60 })
export function isAlipayPending(state: string) {
  return state === 'pending' || state === 'refunding'
}
export function isAlipayCheckoutUrl(value: string) {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      ['openapi.alipay.com', 'openapi-sandbox.dl.alipaydev.com'].includes(url.hostname) &&
      url.pathname === '/gateway.do'
    )
  } catch {
    return false
  }
}
export function estimatedAlipayCredit(amount: string, ratio: string) {
  if (!/^\d{1,8}(?:\.\d{0,2})?$/.test(amount) || !/^\d{1,10}(?:\.\d{0,4})?$/.test(ratio))
    return '0.0000'
  const scaled = (value: string, places: number) => {
    const [whole, fraction = ''] = value.split('.')
    return BigInt(whole! + fraction.padEnd(places, '0'))
  }
  const credit = (scaled(amount, 2) * scaled(ratio, 4)) / 100n
  return `${credit / 10000n}.${(credit % 10000n).toString().padStart(4, '0')}`
}
