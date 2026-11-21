import { computed, ref, type Ref } from 'vue'
import { balanceTransactionService } from '@/service/balanceTransactionService'
import { i18ns } from '@/locales'
import { showRequestErrorNotice } from '@/utils/requestErrorNotice'

const QUOTA_RANGES = ['all', 'today', '7d'] as const
type QuotaRange = (typeof QUOTA_RANGES)[number]
const QUOTA_LABELS = {
  all: 'balance.totalConsumptionQuota',
  today: 'balance.todayConsumptionQuota',
  '7d': 'balance.sevenDayConsumptionQuota',
} as const
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

export function useConsumptionQuota(usageStats: Ref<{ used: number }>) {
  const range = ref<QuotaRange>('all')
  const loading = ref(false)
  const periodAmount = ref<number | null>(null)
  let loadToken = 0

  const nextRange = computed(
    () => QUOTA_RANGES[(QUOTA_RANGES.indexOf(range.value) + 1) % QUOTA_RANGES.length]!,
  )
  const label = computed(() => i18ns.t(QUOTA_LABELS[range.value]))
  const switchLabel = computed(() =>
    i18ns.t('balance.switchConsumptionQuota', { range: i18ns.t(QUOTA_LABELS[nextRange.value]) }),
  )
  const amount = computed(() =>
    range.value === 'all' ? usageStats.value.used : periodAmount.value,
  )

  const cycleRange = async () => {
    range.value = nextRange.value
    const token = ++loadToken
    periodAmount.value = null
    loading.value = range.value !== 'all'
    if (range.value === 'all') return

    const end = new Date()
    const start = new Date(end)
    if (range.value === 'today') start.setHours(0, 0, 0, 0)
    else start.setTime(end.getTime() - SEVEN_DAYS_MS)

    try {
      const result = await balanceTransactionService.getConsumptionAmount(
        start.toISOString(),
        end.toISOString(),
      )
      if (token === loadToken) periodAmount.value = result
    } catch (error) {
      if (token === loadToken) showRequestErrorNotice(error, i18ns.t('balance.loadFailed'))
    } finally {
      if (token === loadToken) loading.value = false
    }
  }

  return { label, switchLabel, amount, loading, cycleRange }
}
