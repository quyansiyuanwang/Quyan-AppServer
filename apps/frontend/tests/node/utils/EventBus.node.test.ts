import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mountedHooks, unmountedHooks } = vi.hoisted(() => ({
  mountedHooks: [] as Array<() => void>,
  unmountedHooks: [] as Array<() => void>,
}))

vi.mock('vue', () => ({
  onMounted: (handler: () => void) => mountedHooks.push(handler),
  onBeforeUnmount: (handler: () => void) => unmountedHooks.push(handler),
}))

import { EventBus } from '@/utils/EventBus'

type TestEvents = 'ready' | 'update'

describe('EventBus', () => {
  beforeEach(() => {
    mountedHooks.length = 0
    unmountedHooks.length = 0
    vi.clearAllMocks()
  })

  it('registers listeners with ahead priority and emits in order', () => {
    const bus = new EventBus<TestEvents, (value: number) => void>()
    const callOrder: string[] = []

    bus.on('ready', () => callOrder.push('normal'))
    bus.on('ready', () => callOrder.push('ahead'), true)

    bus.emit('ready', 1)

    expect(callOrder).toEqual(['ahead', 'normal'])
  })

  it('removes listener with off', () => {
    const bus = new EventBus<TestEvents, () => void>()
    const listener = vi.fn()

    bus.on('ready', listener)
    expect(bus._get_listeners('ready')).toHaveLength(1)

    bus.off('ready', listener)
    bus.emit('ready')

    expect(bus._get_listeners('ready')).toHaveLength(0)
    expect(listener).not.toHaveBeenCalled()
  })

  it('auto binds on mount and unbinds on unmount for multiple events', () => {
    const bus = new EventBus<TestEvents, (value: number) => void>()
    const listener = vi.fn()

    bus.auto(['ready', 'update'], listener)

    expect(mountedHooks).toHaveLength(2)
    expect(unmountedHooks).toHaveLength(2)

    mountedHooks.forEach((hook) => hook())
    bus.emit('ready', 1)
    bus.emit('update', 2)

    expect(listener).toHaveBeenCalledTimes(2)

    unmountedHooks.forEach((hook) => hook())
    bus.emit('ready', 3)

    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('auto binds and unbinds for a single event key', () => {
    const bus = new EventBus<TestEvents, (value: number) => void>()
    const listener = vi.fn()

    bus.auto('ready', listener, true)

    expect(mountedHooks).toHaveLength(1)
    expect(unmountedHooks).toHaveLength(1)

    mountedHooks[0]?.()
    bus.emit('ready', 1)

    expect(listener).toHaveBeenCalledTimes(1)

    unmountedHooks[0]?.()
    bus.emit('ready', 2)

    expect(listener).toHaveBeenCalledTimes(1)
  })
})
