import type {
  RouteLocationRaw,
  RouteLocationResolvedGeneric,
  RouteRecordNormalized,
  Router,
} from 'vue-router'

type RouteComponentLoader = () => unknown

let routeComponentPreloadPromises = new WeakMap<RouteComponentLoader, Promise<void>>()
let preloadedRouteComponents = new WeakSet<RouteComponentLoader>()
const preloadRouteComponent = async (loader: RouteComponentLoader): Promise<void> => {
  if (preloadedRouteComponents.has(loader)) return

  const existingPromise = routeComponentPreloadPromises.get(loader)
  if (existingPromise) {
    await existingPromise
    return
  }

  const preloadPromise = Promise.resolve()
    .then(() => loader())
    .then(() => {
      preloadedRouteComponents.add(loader)
    })
    .catch((error) => {
      routeComponentPreloadPromises.delete(loader)
      console.warn('[router] Failed to preload route component:', error)
    })

  routeComponentPreloadPromises.set(loader, preloadPromise)
  await preloadPromise
}

export const preloadRouteComponents = async (
  records: readonly RouteRecordNormalized[],
): Promise<void> => {
  const loaders = Array.from(
    new Set(
      records
        .flatMap((record) => Object.values(record.components ?? {}))
        .filter((loader): loader is RouteComponentLoader => typeof loader === 'function'),
    ),
  )

  await Promise.all(loaders.map((loader) => preloadRouteComponent(loader)))
}

export const preloadResolvedRouteComponents = async (
  resolved: RouteLocationResolvedGeneric,
): Promise<void> => {
  await preloadRouteComponents(resolved.matched)
}

export const preloadRouteLocation = async (
  router: Router,
  target: RouteLocationRaw,
): Promise<void> => {
  await preloadResolvedRouteComponents(router.resolve(target))
}

export const __resetRoutePreloadStateForTests = (): void => {
  routeComponentPreloadPromises = new WeakMap<RouteComponentLoader, Promise<void>>()
  preloadedRouteComponents = new WeakSet<RouteComponentLoader>()
}
