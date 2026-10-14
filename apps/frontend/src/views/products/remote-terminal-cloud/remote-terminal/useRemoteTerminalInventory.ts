import { reactive, ref } from 'vue'
import type {
  RemoteTerminalDeviceDto,
  RemoteTerminalSessionSummaryDto,
  RemoteTerminalUsageSummaryDto,
} from '@/client/types.gen'

type InventorySource = {
  probeDevices(): Promise<unknown>
  listDevices(): Promise<RemoteTerminalDeviceDto[]>
  listSessions(): Promise<RemoteTerminalSessionSummaryDto[]>
  getUsageSummary(): Promise<RemoteTerminalUsageSummaryDto>
}
type Section = 'devices' | 'sessions' | 'usage'
type SectionState = 'idle' | 'loading' | 'ready' | 'failed'

/** Independent sections preserve admitted data without retaining a previous authorization projection. */
export function useRemoteTerminalInventory(source: InventorySource, identity: () => string) {
  const devices = ref<RemoteTerminalDeviceDto[]>([])
  const sessions = ref<RemoteTerminalSessionSummaryDto[]>([])
  const usageSummary = ref<RemoteTerminalUsageSummaryDto | null>(null)
  const sections = reactive<Record<Section, SectionState>>({
    devices: 'idle',
    sessions: 'idle',
    usage: 'idle',
  })
  const loading = ref(false)
  let generation = 0

  const clear = () => {
    devices.value = []
    sessions.value = []
    usageSummary.value = null
  }
  const invalidate = () => {
    generation += 1
    clear()
    loading.value = false
    sections.devices = sections.sessions = sections.usage = 'idle'
  }
  const refresh = async (): Promise<boolean> => {
    const attempt = ++generation,
      owner = identity()
    const current = () => attempt === generation && owner === identity()
    clear()
    loading.value = true
    sections.devices = sections.sessions = sections.usage = 'loading'
    const load = async <T>(section: Section, fetch: () => Promise<T>, apply: (data: T) => void) => {
      try {
        const data = await fetch()
        if (!current()) return
        apply(data)
        sections[section] = 'ready'
      } catch {
        if (current()) sections[section] = 'failed'
      }
    }
    await Promise.all([
      load(
        'devices',
        async () => {
          await source.probeDevices().catch(() => undefined)
          if (!current()) return []
          return source.listDevices()
        },
        (items) => {
          devices.value = items
        },
      ),
      load(
        'sessions',
        () => source.listSessions(),
        (items) => {
          sessions.value = items
        },
      ),
      load(
        'usage',
        () => source.getUsageSummary(),
        (summary) => {
          usageSummary.value = summary
        },
      ),
    ])
    if (!current()) {
      // A newer request owns its state; only clear the projection if the identity itself changed.
      if (attempt === generation) invalidate()
      return false
    }
    loading.value = false
    return true
  }
  return { devices, sessions, usageSummary, sections, loading, refresh, invalidate }
}
