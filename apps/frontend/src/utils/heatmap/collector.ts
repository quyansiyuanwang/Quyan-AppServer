import { TypedSessionStorage } from '@/utils/typedSessionStorage'
import StorageKey from '@/constant/storagekey'
interface HeatPoint {
  pointType: 'click' | 'scroll_stop'
  page: string
  xRatio: number
  yRatio: number
  scrollDepth: number
  viewportW: number
  viewportH: number
  sessionId?: string
  timestamp: number
}

const FLUSH_INTERVAL = 5000
const ENDPOINT = '/v1/heatmap/collect'

function getSessionId(): string {
  return TypedSessionStorage.getItem(StorageKey.Tracking.SESSION_ID) ?? ''
}

class HeatCollector {
  private queue: HeatPoint[] = []
  private blacklist: string[] = []
  private timer: ReturnType<typeof setInterval> | null = null
  private scrollTimer: ReturnType<typeof setTimeout> | null = null
  private initialized = false

  init(options: { blacklist?: string[] } = {}) {
    if (this.initialized) return
    this.initialized = true
    this.blacklist = options.blacklist ?? []

    this.setupClickCapture()
    this.setupScrollCapture()
    this.timer = setInterval(() => this.flush(), FLUSH_INTERVAL)
    window.addEventListener('beforeunload', () => this.flush())
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flush()
    })
  }

  private isBlacklisted(): boolean {
    return this.blacklist.some((path) => location.pathname.startsWith(path))
  }

  private setupClickCapture() {
    document.addEventListener(
      'click',
      (e: MouseEvent) => {
        if (this.isBlacklisted()) return
        const xRatio = e.clientX / window.innerWidth
        const yRatio = e.clientY / window.innerHeight
        this.queue.push({
          pointType: 'click',
          page: location.pathname,
          xRatio: Math.max(0, Math.min(1, xRatio)),
          yRatio: Math.max(0, Math.min(1, yRatio)),
          scrollDepth: this.getScrollDepth(),
          viewportW: window.innerWidth,
          viewportH: window.innerHeight,
          sessionId: getSessionId(),
          timestamp: Date.now(),
        })
      },
      true,
    )
  }

  private setupScrollCapture() {
    window.addEventListener(
      'scroll',
      () => {
        if (this.scrollTimer) clearTimeout(this.scrollTimer)
        this.scrollTimer = setTimeout(() => {
          if (this.isBlacklisted()) return
          const scrollHeight = document.body.scrollHeight
          const yRatio = (window.scrollY + window.innerHeight / 2) / Math.max(scrollHeight, 1)
          this.queue.push({
            pointType: 'scroll_stop',
            page: location.pathname,
            xRatio: 0.5,
            yRatio: Math.max(0, Math.min(1, yRatio)),
            scrollDepth: this.getScrollDepth(),
            viewportW: window.innerWidth,
            viewportH: window.innerHeight,
            sessionId: getSessionId(),
            timestamp: Date.now(),
          })
        }, 1500)
      },
      { passive: true },
    )
  }

  private getScrollDepth(): number {
    const scrollable = document.body.scrollHeight - window.innerHeight
    if (scrollable <= 0) return 100
    return Math.round((window.scrollY / scrollable) * 100)
  }

  flush() {
    if (this.queue.length === 0) return
    const points = this.queue.splice(0)
    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ points }),
      keepalive: true,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
      })
      .catch(() => {
        this.queue.unshift(...points)
      })
  }
}

export const heatCollector = new HeatCollector()
