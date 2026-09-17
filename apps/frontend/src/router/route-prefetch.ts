import { ROUTE_PREFETCH_POLICY as policy } from '@/config/loading-policy'
import { hasForegroundRequests, onForegroundIdle } from '@/utils/foreground-activity'
import type { RouteLocationRaw, RouteLocationResolvedGeneric, Router } from 'vue-router'
import { preloadRouteViewComponents } from './domain-view-loader'
import {
  getSiteProfilesForEnvironment,
  isKnownSiteProfile,
  type ResolvedSiteProfile,
} from '@/config/site-registry'
import { usePermissionStore } from '@/stores/permissionStore'
import { useSessionStore } from '@/stores/sessionStore'
import { routeAccessState } from './route-access'

type Connection = { saveData?: boolean; effectiveType?: string }
type Job = { key: string; route: RouteLocationResolvedGeneric; priority: number }

/** Speculative code/CSS only. Actual router navigation always bypasses this queue. */
export const installRoutePrefetch = (router: Router, currentSiteProfile: ResolvedSiteProfile) => {
  const queue = new Map<string, Job>()
  const running = new Set<string>()
  const recent: RouteLocationRaw[] = []
  const connectedOrigins = new Set<string>()
  let active = 0
  let navigating = true
  let disposed = false
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  let hoverTimer: ReturnType<typeof setTimeout> | undefined
  let hoverElement: Element | null = null

  const available = () =>
    !disposed && navigator.onLine !== false && document.visibilityState !== 'hidden'
  const allowIdle = () => {
    const connection = (navigator as Navigator & { connection?: Connection }).connection
    return (
      !connection?.saveData &&
      !policy.restrictedConnections.some((type) => type === connection?.effectiveType)
    )
  }
  const authorized = (route: RouteLocationResolvedGeneric) => {
    const session = useSessionStore()
    return (
      route.matched.length > 0 &&
      !route.matched.some((record) => record.redirect) &&
      route.matched.every((record) => {
        if (record.meta.allowGuest || record.meta.isAuthEntry) return true
        if (!session.isAuthenticated || session.permissionsStatus !== 'ready') return false
        return !record.meta.permission || usePermissionStore().hasPermission(record.meta.permission)
      })
    )
  }
  const pump = () => {
    if (
      !available() ||
      navigating ||
      hasForegroundRequests() ||
      routeAccessState.status.value !== 'idle'
    )
      return
    for (const job of [...queue.values()].sort((a, b) => b.priority - a.priority)) {
      if (active >= policy.concurrency) break
      queue.delete(job.key)
      if ((!job.priority && !allowIdle()) || !authorized(job.route)) continue
      active++
      running.add(job.key)
      void preloadRouteViewComponents(job.route).finally(() => {
        active--
        running.delete(job.key)
        pump()
      })
    }
  }
  const enqueue = (target: RouteLocationRaw, priority: number) => {
    let route: RouteLocationResolvedGeneric
    try {
      route = router.resolve(target)
    } catch {
      return
    }
    if (!authorized(route) || route.name === router.currentRoute.value.name) return
    const key = route.matched.map((record) => String(record.name ?? record.path)).join('|')
    if (running.has(key)) return
    const existing = queue.get(key)
    if (existing) existing.priority = Math.max(priority, existing.priority)
    else if (queue.size < policy.maxPendingTargets) queue.set(key, { key, route, priority })
    pump()
  }
  const preconnect = (url: URL) => {
    if (
      !available() ||
      !allowIdle() ||
      connectedOrigins.has(url.origin) ||
      connectedOrigins.size >= policy.maxConnectedOrigins ||
      !isKnownSiteProfile(currentSiteProfile)
    )
      return
    if (
      !getSiteProfilesForEnvironment(currentSiteProfile).some(
        (profile) => profile.canonicalOrigin === url.origin,
      )
    )
      return
    connectedOrigins.add(url.origin)
    const link = document.createElement('link')
    link.rel = 'preconnect'
    link.href = url.origin
    link.dataset.routePreconnect = 'true'
    document.head.append(link)
  }
  const targetElement = (event: Event) =>
    event.target instanceof Element
      ? event.target.closest('[data-route-name], [data-prefetch-origin], a[href]')
      : null
  const preloadElement = (element: Element) => {
    if (!available()) return
    const origin = element.getAttribute('data-prefetch-origin')
    if (origin && origin !== window.location.origin) {
      try {
        preconnect(new URL(origin))
      } catch {
        /* malformed target */
      }
      return
    }
    const name = element.getAttribute('data-route-name')
    if (name) {
      if (router.hasRoute(name)) enqueue({ name } as RouteLocationRaw, 1)
      return
    }
    if (
      !(element instanceof HTMLAnchorElement) ||
      element.hasAttribute('download') ||
      (element.target && element.target !== '_self')
    )
      return
    const url = new URL(element.href, window.location.href)
    if (url.origin !== window.location.origin) {
      preconnect(url)
      return
    }
    enqueue(`${url.pathname}${url.search}${url.hash}`, 1)
  }
  const intent = (event: Event) => {
    const element = targetElement(event)
    if (!element) return
    if (event.type === 'pointerover') {
      if (element === hoverElement) return
      clearTimeout(hoverTimer)
      hoverElement = element
      hoverTimer = setTimeout(() => {
        hoverElement = null
        preloadElement(element)
      }, policy.hoverDelayMs)
    } else preloadElement(element)
  }
  const leave = (event: PointerEvent) => {
    if (
      hoverElement &&
      (!(event.relatedTarget instanceof Node) || !hoverElement.contains(event.relatedTarget))
    ) {
      clearTimeout(hoverTimer)
      hoverElement = null
    }
  }
  const scheduleIdle = () => {
    clearTimeout(idleTimer)
    if (!available() || !allowIdle()) return
    idleTimer = setTimeout(() => {
      if (
        !available() ||
        navigating ||
        hasForegroundRequests() ||
        routeAccessState.status.value !== 'idle'
      )
        return
      // User-pinned destinations first; then recent routes and visible menu entries.
      const elements = [...document.querySelectorAll('[data-route-name]')].filter(
        (element) => element.getClientRects().length > 0,
      )
      const pinned = elements.filter((element) => element.classList.contains('pinned-menu-link'))
      const seen = new Set<string>()
      const candidates: RouteLocationRaw[] = [
        ...pinned.map(
          (element) => ({ name: element.getAttribute('data-route-name')! }) as RouteLocationRaw,
        ),
        ...recent,
        ...elements.map(
          (element) => ({ name: element.getAttribute('data-route-name')! }) as RouteLocationRaw,
        ),
      ]
      for (const target of candidates) {
        let route: RouteLocationResolvedGeneric
        try {
          route = router.resolve(target)
        } catch {
          continue
        }
        const key = String(route.name ?? route.path)
        if (seen.has(key) || route.name === router.currentRoute.value.name || !authorized(route))
          continue
        seen.add(key)
        enqueue(target, 0)
        if (seen.size >= policy.maxIdleTargets) break
      }
    }, policy.idleDelayMs)
  }
  const stopIdle = onForegroundIdle(() => {
    pump()
    scheduleIdle()
  })
  const stopBefore = router.beforeEach(() => {
    navigating = true
    queue.clear()
    clearTimeout(idleTimer)
    clearTimeout(hoverTimer)
  })
  const stopAfter = router.afterEach((to, _from, failure) => {
    navigating = false
    if (!failure && to.name) {
      recent.unshift(to.fullPath)
      recent.splice(policy.maxRecentTargets)
    }
    pump()
    scheduleIdle()
  })
  const stopError = router.onError(() => {
    navigating = false
  })
  const onAvailability = () => {
    if (!available()) {
      queue.clear()
      clearTimeout(idleTimer)
      clearTimeout(hoverTimer)
    } else {
      pump()
      scheduleIdle()
    }
  }
  document.addEventListener('pointerover', intent, true)
  document.addEventListener('pointerout', leave, true)
  document.addEventListener('focusin', intent, true)
  document.addEventListener('pointerdown', intent, true)
  document.addEventListener('visibilitychange', onAvailability)
  window.addEventListener('online', onAvailability)
  window.addEventListener('offline', onAvailability)
  return () => {
    disposed = true
    queue.clear()
    clearTimeout(idleTimer)
    clearTimeout(hoverTimer)
    stopBefore()
    stopAfter()
    stopError()
    stopIdle()
    document.removeEventListener('pointerover', intent, true)
    document.removeEventListener('pointerout', leave, true)
    document.removeEventListener('focusin', intent, true)
    document.removeEventListener('pointerdown', intent, true)
    document.removeEventListener('visibilitychange', onAvailability)
    window.removeEventListener('online', onAvailability)
    window.removeEventListener('offline', onAvailability)
    document.querySelectorAll('link[data-route-preconnect]').forEach((element) => element.remove())
  }
}
