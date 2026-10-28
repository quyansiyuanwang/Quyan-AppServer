import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useRemoteTerminalInventory } from '@/views/products/remote-terminal-cloud/remote-terminal/useRemoteTerminalInventory'
import type {
  RemoteTerminalDeviceDto,
  RemoteTerminalSessionSummaryDto,
  RemoteTerminalUsageSummaryDto,
} from '@/client/types.gen'
const device: RemoteTerminalDeviceDto = {
  deviceId: 'allowed-device',
  hostname: 'fixture',
  platform: 'linux',
  arch: 'x64',
  availableShells: ['bash'],
  lastSeenAt: '2026-10-14T00:00:00Z',
  registeredAt: '2026-10-14T00:00:00Z',
  online: true,
}
const session: RemoteTerminalSessionSummaryDto = {
  sessionId: 'allowed-session',
  deviceId: device.deviceId,
  mode: 'shell',
  shellType: 'bash',
  status: 'connected',
  createdAt: device.registeredAt,
}
const usage: RemoteTerminalUsageSummaryDto = {
  activeSessionCount: 1,
  totalTerminalLimit: 2,
  remainingTerminalCount: 1,
  activeDeviceCount: 1,
  totalDeviceLimit: 2,
  remainingDeviceCount: 1,
  terminalQuotaReached: false,
  deviceQuotaReached: false,
}
const source = {
  probeDevices: vi.fn(),
  listDevices: vi.fn(),
  listSessions: vi.fn(),
  getUsageSummary: vi.fn(),
}
let identity: string
beforeEach(() => {
  vi.resetAllMocks()
  identity = 'actor:v1'
  source.probeDevices.mockResolvedValue(undefined)
  source.listDevices.mockResolvedValue([device])
  source.listSessions.mockResolvedValue([session])
  source.getUsageSummary.mockResolvedValue(usage)
})
const state = () => useRemoteTerminalInventory(source, () => identity)
const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
describe('terminal workspace partial IAM access', () => {
  it('retains granted device data when sessions and usage are denied', async () => {
    source.listSessions.mockRejectedValue(new Error('denied'))
    source.getUsageSummary.mockRejectedValue(new Error('denied'))
    const inventory = state()
    expect(await inventory.refresh()).toBe(true)
    expect(inventory.devices.value).toEqual([device])
    expect(inventory.sessions.value).toEqual([])
    expect(inventory.usageSummary.value).toBeNull()
    expect(inventory.sections).toEqual({ devices: 'ready', sessions: 'failed', usage: 'failed' })
  })
  it('keeps session-only access and does not invent device or quota information', async () => {
    source.listDevices.mockRejectedValue(new Error('denied'))
    source.getUsageSummary.mockRejectedValue(new Error('denied'))
    const inventory = state()
    await inventory.refresh()
    expect(inventory.sessions.value).toEqual([session])
    expect(inventory.devices.value).toEqual([])
    expect(inventory.usageSummary.value).toBeNull()
  })
  it('shows granted sections while another request is pending', async () => {
    const pending = deferred<RemoteTerminalUsageSummaryDto>()
    source.getUsageSummary.mockReturnValue(pending.promise)
    const inventory = state(),
      loading = inventory.refresh()
    await vi.waitFor(() => expect(inventory.sections.devices).toBe('ready'))
    expect(inventory.devices.value).toEqual([device])
    expect(inventory.sections.usage).toBe('loading')
    expect(inventory.loading.value).toBe(true)
    pending.resolve(usage)
    await loading
    expect(inventory.usageSummary.value).toEqual(usage)
  })
  it('clears previously authorized rows and quota when refresh is denied', async () => {
    const inventory = state()
    await inventory.refresh()
    source.listDevices.mockRejectedValue(new Error('revoked'))
    source.listSessions.mockRejectedValue(new Error('revoked'))
    source.getUsageSummary.mockRejectedValue(new Error('revoked'))
    const loading = inventory.refresh()
    expect(inventory.devices.value).toEqual([])
    expect(inventory.usageSummary.value).toBeNull()
    await loading
    expect(inventory.sessions.value).toEqual([])
    expect(Object.values(inventory.sections)).toEqual(['failed', 'failed', 'failed'])
  })
  it('does not let an older successful request restore revoked rows', async () => {
    const old = deferred<RemoteTerminalDeviceDto[]>()
    source.listDevices.mockReturnValueOnce(old.promise)
    const inventory = state(),
      first = inventory.refresh()
    await vi.waitFor(() => expect(source.listDevices).toHaveBeenCalledTimes(1))
    source.listDevices.mockRejectedValue(new Error('revoked'))
    await inventory.refresh()
    old.resolve([device])
    expect(await first).toBe(false)
    expect(inventory.devices.value).toEqual([])
    expect(inventory.sections.devices).toBe('failed')
    expect(inventory.loading.value).toBe(false)
  })
  it('discards outstanding results after an authorization identity change', async () => {
    const old = deferred<RemoteTerminalDeviceDto[]>()
    source.listDevices.mockReturnValueOnce(old.promise)
    const inventory = state(),
      first = inventory.refresh()
    await vi.waitFor(() => expect(source.listDevices).toHaveBeenCalledTimes(1))
    identity = 'other-actor:v2'
    old.resolve([device])
    expect(await first).toBe(false)
    expect(inventory.devices.value).toEqual([])
    expect(inventory.sessions.value).toEqual([])
    expect(inventory.usageSummary.value).toBeNull()
  })
  it('clears loading state on disposal without repopulating from a late response', async () => {
    const old = deferred<RemoteTerminalDeviceDto[]>()
    source.listDevices.mockReturnValueOnce(old.promise)
    const inventory = state(),
      first = inventory.refresh()
    await vi.waitFor(() => expect(source.listDevices).toHaveBeenCalledTimes(1))
    inventory.invalidate()
    old.resolve([device])
    expect(await first).toBe(false)
    expect(inventory.devices.value).toEqual([])
    expect(inventory.loading.value).toBe(false)
  })
  it('does not require probe permission to load readable devices', async () => {
    source.probeDevices.mockRejectedValue(new Error('probe denied'))
    const inventory = state()
    await inventory.refresh()
    expect(inventory.devices.value).toEqual([device])
    expect(inventory.sections.devices).toBe('ready')
  })
  it('does not dispatch a device list for a changed identity after a pending probe', async () => {
    const probe = deferred<void>()
    source.probeDevices.mockReturnValue(probe.promise)
    const inventory = state(),
      first = inventory.refresh()
    identity = 'other-actor'
    probe.resolve()
    expect(await first).toBe(false)
    expect(source.listDevices).not.toHaveBeenCalled()
  })
})
