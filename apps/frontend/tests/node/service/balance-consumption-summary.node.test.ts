import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BalanceTransactionResponse } from '@/client/types.gen'

vi.mock('@/stores/request', () => ({ useRequestStore: vi.fn() }))
vi.mock('@/utils/common', () => ({ cacheObject: vi.fn() }))

import { balanceTransactionService } from '@/service/balanceTransactionService'

const start = '2026-11-12T00:00:00.000Z'
const end = '2026-11-19T00:00:00.000Z'
const record = (type: string, amount: number, extra = {}) =>
  ({ type, amount, ...extra }) as BalanceTransactionResponse

describe('balance consumption summary', () => {
  afterEach(() => vi.restoreAllMocks())

  it('sums every server page and excludes funding, transfers, coverage, and non-charges', async () => {
    const records = [
      record('api_usage', -0.1),
      record('api_usage', -0.2),
      record('api_usage', 0),
      record('api_usage', 1),
      record('recharge', -0.5, { model: 'legacy-chat' }),
      record('recharge', -20),
      record('redemption', 100),
      record('peer_transfer_out', -10),
      record('monthly_pass_coverage', 0),
      ...Array.from({ length: 91 }, () => record('api_usage', 0)),
    ]
    const query = vi.spyOn(balanceTransactionService, 'getMyTransactions')
    query
      .mockResolvedValueOnce({ data: { records, total: 101 } } as never)
      .mockResolvedValueOnce({ data: { records: [record('api_usage', -1)], total: 101 } } as never)

    expect(await balanceTransactionService.getConsumptionAmount(start, end)).toBe(1.8)
    expect(query).toHaveBeenNthCalledWith(1, {
      startTime: start,
      endTime: end,
      limit: 100,
      offset: 0,
    })
    expect(query).toHaveBeenNthCalledWith(2, {
      startTime: start,
      endTime: end,
      limit: 100,
      offset: 100,
    })
  })

  it('returns zero for a successful empty range', async () => {
    vi.spyOn(balanceTransactionService, 'getMyTransactions').mockResolvedValue({
      data: { records: [], total: 0 },
    } as never)
    expect(await balanceTransactionService.getConsumptionAmount(start, end)).toBe(0)
  })

  it('rejects an incomplete summary rather than returning a partial amount', async () => {
    vi.spyOn(balanceTransactionService, 'getMyTransactions')
      .mockResolvedValueOnce({ data: { records: [record('api_usage', -1)], total: 2 } } as never)
      .mockResolvedValueOnce({ data: { records: [], total: 2 } } as never)
    await expect(balanceTransactionService.getConsumptionAmount(start, end)).rejects.toThrow(
      'Consumption summary is incomplete',
    )
  })

  it('propagates a failed page query', async () => {
    vi.spyOn(balanceTransactionService, 'getMyTransactions').mockRejectedValue(
      new Error('unavailable'),
    )
    await expect(balanceTransactionService.getConsumptionAmount(start, end)).rejects.toThrow(
      'unavailable',
    )
  })
})
