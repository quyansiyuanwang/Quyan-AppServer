import { ref, shallowRef } from 'vue'
import type { CreateRamAuthorizationDto } from '@/client/types.gen'
/** Each saved relation is independent. Stop on failure; retry only the remaining snapshot. */
export function useIamAuthorizationBatch(
  create: (request: CreateRamAuthorizationDto) => Promise<unknown>,
) {
  const busy = ref(false),
    total = ref(0),
    completed = ref(0)
  const pending = shallowRef<CreateRamAuthorizationDto[]>()
  let disposed = false
  const run = async (requests?: readonly CreateRamAuthorizationDto[]) => {
    if (busy.value || disposed) return false
    if (!pending.value) {
      if (!requests?.length) return false
      pending.value = requests.map((request) => ({ ...request }))
      total.value = requests.length
      completed.value = 0
    }
    busy.value = true
    try {
      while (pending.value?.length && !disposed) {
        const request = pending.value[0]
        if (!request) break
        await create({ ...request })
        completed.value++
        pending.value = pending.value.slice(1)
      }
      if (disposed) return false
      pending.value = undefined
      return true
    } finally {
      busy.value = false
    }
  }
  const discard = () => {
    if (busy.value) return
    pending.value = undefined
    total.value = 0
    completed.value = 0
  }
  const dispose = () => {
    disposed = true
  }
  return { busy, total, completed, pending, run, discard, dispose }
}
