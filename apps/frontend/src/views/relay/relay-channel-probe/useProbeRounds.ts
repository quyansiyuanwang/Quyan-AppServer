import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from '@/utils/elementPlusRuntime'
import { showRequestErrorNotice } from '@/utils/requestErrorNotice'
import { i18ns } from '@/locales'
import service from '@/service/relayProbeRoundService'
import type {
  RelayProbeDailyScheduleDto,
  RelayProbeRoundDto,
  RelayProbeRoundTargetPageDto,
} from '@/client/types.gen'

export function useProbeRounds(active: Ref<boolean>) {
  const route = useRoute(),
    router = useRouter()
  const schedule = ref<RelayProbeDailyScheduleDto>(),
    enabled = ref(false),
    time = ref('03:00')
  const saving = ref(false),
    loading = ref(false),
    detailLoading = ref(false),
    error = ref('')
  const rounds = ref<RelayProbeRoundDto[]>([]),
    total = ref(0),
    page = ref(1),
    pageSize = ref(20)
  const detail = ref<RelayProbeRoundTargetPageDto>(),
    selectedId = ref(''),
    detailPage = ref(1),
    detailSize = ref(20)
  let listSequence = 0,
    detailSequence = 0,
    scheduleSequence = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  const hasActiveRound = computed(() =>
    rounds.value.some((round) => ['pending', 'running'].includes(round.state)),
  )
  const dirty = computed(
    () =>
      schedule.value &&
      (enabled.value !== schedule.value.enabled ||
        time.value !==
          `${String(Math.floor(schedule.value.minuteOfDay / 60)).padStart(2, '0')}:${String(schedule.value.minuteOfDay % 60).padStart(2, '0')}`),
  )
  const readableError = () => i18ns.t('relay.probeRoundLoadFailed')

  async function loadSchedule() {
    const sequence = ++scheduleSequence
    try {
      const value = await service.schedule()
      if (sequence !== scheduleSequence || disposed) return
      if (dirty.value) return
      schedule.value = value
      enabled.value = value.enabled
      time.value = `${String(Math.floor(value.minuteOfDay / 60)).padStart(2, '0')}:${String(value.minuteOfDay % 60).padStart(2, '0')}`
    } catch {
      if (sequence === scheduleSequence && !disposed) error.value = readableError()
    }
  }
  async function loadRounds() {
    const sequence = ++listSequence
    loading.value = true
    try {
      const value = await service.list(page.value, pageSize.value)
      if (sequence !== listSequence || disposed) return
      rounds.value = value.items
      total.value = value.total
      error.value = ''
    } catch {
      if (sequence === listSequence && !disposed) error.value = readableError()
    } finally {
      if (sequence === listSequence && !disposed) loading.value = false
    }
  }
  async function loadDetail() {
    if (!selectedId.value) return
    const sequence = ++detailSequence
    detailLoading.value = true
    try {
      const value = await service.detail(selectedId.value, detailPage.value, detailSize.value)
      if (sequence === detailSequence && !disposed) detail.value = value
    } catch {
      if (sequence === detailSequence && !disposed) error.value = readableError()
    } finally {
      if (sequence === detailSequence && !disposed) detailLoading.value = false
    }
  }
  async function selectRound(id: string) {
    selectedId.value = id
    detailPage.value = 1
    detail.value = undefined
    await router.replace({ query: { ...route.query, round: id } })
    await loadDetail()
  }
  async function save() {
    if (!schedule.value || saving.value) return
    const parts = time.value.split(':').map(Number)
    if (
      parts.length !== 2 ||
      !parts.every(Number.isInteger) ||
      parts[0]! < 0 ||
      parts[0]! > 23 ||
      parts[1]! < 0 ||
      parts[1]! > 59
    ) {
      ElMessage.error(i18ns.t('relay.probeRoundTimeInvalid'))
      return
    }
    saving.value = true
    ++scheduleSequence
    try {
      schedule.value = await service.save({
        enabled: enabled.value,
        minuteOfDay: parts[0]! * 60 + parts[1]!,
        expectedVersion: schedule.value.version,
      })
      ElMessage.success(i18ns.t('success'))
    } catch (failure) {
      showRequestErrorNotice(failure)
    } finally {
      saving.value = false
    }
  }
  function stopPolling() {
    if (timer) clearTimeout(timer)
    timer = undefined
  }
  function poll() {
    stopPolling()
    if (disposed || !active.value || document.hidden || !hasActiveRound.value) return
    timer = setTimeout(async () => {
      await loadRounds()
      if (selectedId.value) await loadDetail()
      poll()
    }, 15_000)
  }
  async function refresh() {
    await Promise.allSettled([loadSchedule(), loadRounds(), loadDetail()])
    poll()
  }
  function visibilityChanged() {
    if (document.hidden) stopPolling()
    else if (active.value) void refresh()
  }
  document.addEventListener('visibilitychange', visibilityChanged)
  watch(
    active,
    (value) => {
      if (value) void refresh()
      else stopPolling()
    },
    { immediate: true },
  )
  watch([page, pageSize], () => {
    void loadRounds()
  })
  watch([detailPage, detailSize], () => {
    void loadDetail()
  })
  watch(
    () => route.query.round,
    (id) => {
      if (typeof id === 'string' && id !== selectedId.value) {
        selectedId.value = id
        detailPage.value = 1
        void loadDetail()
      }
    },
    { immediate: true },
  )
  onBeforeUnmount(() => {
    disposed = true
    ++listSequence
    ++detailSequence
    ++scheduleSequence
    stopPolling()
    document.removeEventListener('visibilitychange', visibilityChanged)
  })
  return {
    schedule,
    enabled,
    time,
    saving,
    loading,
    detailLoading,
    error,
    rounds,
    total,
    page,
    pageSize,
    detail,
    detailPage,
    detailSize,
    loadRounds,
    loadDetail,
    selectRound,
    save,
    refresh,
  }
}
