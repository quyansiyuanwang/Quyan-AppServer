import type { App } from 'vue'
import { tracker } from '@/utils/tracker'
import { setupAutoClickTrack } from '@/utils/tracker/autoClick'
import { heatCollector } from '@/utils/heatmap/collector'
import { vTrack } from '@/directives/track'

const BLACKLIST = ['/login', '/register', '/forgot-password', '/reset-password']

function setupErrorTracking() {
  window.addEventListener('error', (e) => {
    tracker.track('error', 'js_error', {
      message: e.message,
      source: e.filename,
      line: e.lineno,
      col: e.colno,
    })
  })

  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason instanceof Error ? e.reason.message : String(e.reason)
    tracker.track('error', 'promise_rejection', { message: reason })
  })
}

function setupPerformanceTracking() {
  window.addEventListener('load', () => {
    const nav = performance.getEntriesByType('navigation')[0] as
      | PerformanceNavigationTiming
      | undefined
    if (!nav) return
    tracker.track('performance', 'page_load', {
      ttfb: Math.round(nav.responseStart - nav.requestStart),
      domReady: Math.round(nav.domContentLoadedEventEnd - nav.startTime),
      loadTime: Math.round(nav.loadEventEnd - nav.startTime),
    })
  })
}

export function setupAnalytics(app: App) {
  setupAutoClickTrack()
  setupErrorTracking()
  setupPerformanceTracking()
  heatCollector.init({ blacklist: BLACKLIST })
  app.directive('track', vTrack)
}
