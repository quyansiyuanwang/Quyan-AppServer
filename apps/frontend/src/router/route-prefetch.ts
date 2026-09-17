import type { Router } from 'vue-router'
import { preloadRouteViewComponents } from './domain-view-loader'

/**
 * Preload the destination component as soon as the user demonstrates intent.
 * This only warms JavaScript/CSS; authentication and permission checks still
 * run in the navigation guard before a protected route can mount.
 */
export const installRoutePrefetch = (router: Router) => {
  const preloadFromEvent = (event: Event) => {
    if (!(event.target instanceof Element)) return
    const anchor = event.target.closest('a[href]')
    if (!(anchor instanceof HTMLAnchorElement)) return
    if (anchor.hasAttribute('download') || (anchor.target && anchor.target !== '_self')) return

    const url = new URL(anchor.href, window.location.href)
    if (url.origin !== window.location.origin) return
    const route = router.resolve(`${url.pathname}${url.search}${url.hash}`)
    if (route.matched.length > 0) void preloadRouteViewComponents(route)
  }

  document.addEventListener('pointerenter', preloadFromEvent, true)
  document.addEventListener('focusin', preloadFromEvent, true)
  document.addEventListener('pointerdown', preloadFromEvent, true)

  return () => {
    document.removeEventListener('pointerenter', preloadFromEvent, true)
    document.removeEventListener('focusin', preloadFromEvent, true)
    document.removeEventListener('pointerdown', preloadFromEvent, true)
  }
}
