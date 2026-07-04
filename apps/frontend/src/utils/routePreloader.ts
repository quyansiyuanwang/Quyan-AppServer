import type { RouteRecordRaw } from 'vue-router'
import { routes } from '@/router/routes'

function collectComponentLoaders(
  routesList: readonly RouteRecordRaw[],
): (() => Promise<unknown>)[] {
  const loaders: (() => Promise<unknown>)[] = []

  for (const route of routesList) {
    if (route.component && typeof route.component === 'function') {
      loaders.push(route.component as () => Promise<unknown>)
    }

    if (route.children) {
      loaders.push(...collectComponentLoaders(route.children))
    }
  }

  return loaders
}

export function preloadAllRoutes(): void {
  const loaders = collectComponentLoaders(routes)

  for (const loader of loaders) {
    loader().catch(() => {
      // preload failures are non-critical — the import will retry on actual navigation
    })
  }
}
