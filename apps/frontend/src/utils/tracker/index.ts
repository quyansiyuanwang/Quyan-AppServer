import { HttpClient } from '../http-client'

interface TrackDeviceInfo {
  ua: string
  screenW: number
  screenH: number
  language: string
}

interface TrackEvent {
  eventType: string
  name: string
  page: string
  element?: string
  label?: string
  properties?: Record<string, unknown>
  sessionId: string
  userId?: string
  clientTime: number
  deviceInfo: TrackDeviceInfo
}

const FLUSH_INTERVAL = 3000
const BATCH_SIZE = 10
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? ''
const ENDPOINT = '/v1/track/batch'

/** Keepalive 请求体大小上限（Chrome 64KB，留余量） */
const KEEPALIVE_BODY_LIMIT = 60000

/** 内存保护：队列最大长度，超限丢弃最旧事件 */
const MAX_QUEUE_SIZE = 500

const httpClient = new HttpClient({
  baseUrl: BACKEND_URL,
  timeout: 3000,
  retry: { maxRetries: 2, baseDelay: 1000 },
})

class Tracker {
  private queue: TrackEvent[] = []
  private sessionId: string
  private timer: ReturnType<typeof setInterval> | null = null
  private flushing = false
  private totalDropped = 0

  constructor() {
    if (!BACKEND_URL) {
      console.warn('[Tracker] VITE_BACKEND_URL is not set, tracking disabled')
    }
    this.sessionId = this.getOrCreateSession()
    this.setup()
  }

  private getOrCreateSession(): string {
    const key = 'track_session_id'
    let id = sessionStorage.getItem(key)
    if (!id) {
      id = Math.random().toString(36).slice(2) + Date.now().toString(36)
      sessionStorage.setItem(key, id)
    }
    return id
  }

  private setup() {
    this.timer = setInterval(() => this.flush(), FLUSH_INTERVAL)
    window.addEventListener('beforeunload', () => this.flushKeepalive())
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flushKeepalive()
    })
  }

  track(eventType: string, name: string, properties?: Record<string, unknown>) {
    const event: TrackEvent = {
      eventType,
      name,
      page: location.pathname,
      properties,
      sessionId: this.sessionId,
      clientTime: Date.now(),
      deviceInfo: {
        ua: navigator.userAgent,
        screenW: window.screen.width,
        screenH: window.screen.height,
        language: navigator.language,
      },
    }
    this.queue.push(event)
    this.trimQueue()
    if (this.queue.length >= BATCH_SIZE) this.flush()
  }

  private trimQueue() {
    if (this.queue.length > MAX_QUEUE_SIZE) {
      const dropped = this.queue.splice(0, this.queue.length - MAX_QUEUE_SIZE)
      this.totalDropped += dropped.length
      console.warn(`[Tracker] Queue overflow: dropped ${dropped.length} oldest events`)
    }
  }

  async flush(): Promise<void> {
    if (!BACKEND_URL || this.queue.length === 0 || this.flushing) return
    this.flushing = true
    try {
      const events = this.queue.splice(0)
      if (events.length === 0) return
      await httpClient.post(ENDPOINT, { events })
    } catch (err) {
      this.totalDropped += this.queue.length
      console.error(
        `[Tracker] Failed to flush events:`,
        err instanceof Error ? err.message : String(err),
        `| total dropped: ${this.totalDropped}`,
      )
    } finally {
      this.flushing = false
    }
    if (this.queue.length >= BATCH_SIZE) {
      this.flush()
    }
  }

  private flushKeepalive(): void {
    if (!BACKEND_URL || this.queue.length === 0) return
    const events = this.queue.splice(0)
    const body = JSON.stringify({ events })

    if (body.length <= KEEPALIVE_BODY_LIMIT) {
      httpClient.postKeepalive(ENDPOINT, { events })
    } else {
      this.sendKeepaliveChunked(events)
    }
  }

  private sendKeepaliveChunked(events: TrackEvent[]): void {
    let idx = 0
    while (idx < events.length) {
      const estPerEvent = 200
      const chunkSize = Math.max(1, Math.floor(KEEPALIVE_BODY_LIMIT / estPerEvent))
      const chunk = events.slice(idx, idx + chunkSize)
      idx += chunkSize

      const body = JSON.stringify({ events: chunk })
      if (body.length > KEEPALIVE_BODY_LIMIT) {
        const half = Math.ceil(chunk.length / 2)
        this.sendKeepaliveChunked(chunk.slice(0, half))
        this.sendKeepaliveChunked(chunk.slice(half))
        continue
      }
      httpClient.postKeepalive(ENDPOINT, { events: chunk })
    }
  }

  destroy() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}

export const tracker = new Tracker()
