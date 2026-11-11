export const ALIPAY_POLL_POLICY = Object.freeze({ intervalMs: 5000, maxAttempts: 60 })
export function normalizeAlipayAmount(value: string) {
  const amount = value.trim()
  if (!/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(amount)) return undefined
  return /[1-9]/.test(amount) ? amount : undefined
}
const amountInCents = (amount: string) => {
  const [whole, fraction = ''] = amount.split('.')
  return BigInt(whole! + fraction.padEnd(2, '0'))
}
export function isAlipayAmountInRange(value: string, minimum: string, maximum: string) {
  const amount = normalizeAlipayAmount(value)
  const min = normalizeAlipayAmount(minimum)
  const max = normalizeAlipayAmount(maximum)
  if (!amount || !min || !max) return false
  const cents = amountInCents(amount)
  return cents >= amountInCents(min) && cents <= amountInCents(max)
}
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
  const normalized = normalizeAlipayAmount(amount)
  if (!normalized || !/^\d{1,10}(?:\.\d{0,4})?$/.test(ratio)) return '0.0000'
  const scaled = (value: string, places: number) => {
    const [whole, fraction = ''] = value.split('.')
    return BigInt(whole! + fraction.padEnd(places, '0'))
  }
  const credit = (scaled(normalized, 2) * scaled(ratio, 4)) / 100n
  return `${credit / 10000n}.${(credit % 10000n).toString().padStart(4, '0')}`
}
