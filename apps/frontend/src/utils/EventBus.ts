import { onBeforeUnmount, onMounted } from 'vue'

export type Listener = ((...args: any[]) => any) | ((...args: any[]) => Promise<any>)

export class EventBus<E extends string, L extends Listener = Listener> {
  private listeners: Partial<Record<E, L[]>> = {}

  _get_listeners(event: E): L[] {
    return this.listeners[event] || []
  }

  on(event: E, listener: L, ahead: boolean = false): void {
    console.debug(
      `Registering listener for event: ${event}, listener: ${listener}, ahead: ${ahead}`,
    )
    if (!this.listeners[event]) {
      this.listeners[event] = []
    }

    if (ahead) this.listeners[event].unshift(listener)
    else this.listeners[event].push(listener)
  }

  emit(event: E, ...data: any[]): void {
    console.debug(`Emitting event: ${event} with data:`, data)
    this._get_listeners(event).forEach((listener) => listener(...data))
  }

  off(event: E, listener: L): void {
    console.debug(`Removing listener for event: ${event}`)
    this.listeners[event] = this._get_listeners(event).filter((l) => l !== listener)
  }

  auto(event: E | E[], listener: L, ahead: boolean = false): void {
    const autoEvent = (event: E, listener: L, ahead: boolean = false) => {
      onMounted(() => this.on(event, listener, ahead))
      onBeforeUnmount(() => this.off(event, listener))
    }

    for (const ev of Array.isArray(event) ? event : [event]) autoEvent(ev, listener, ahead)
  }
}
