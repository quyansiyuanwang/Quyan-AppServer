import type { Component } from 'vue'
import type { SiteProfileId } from '@/config/site-registry'
import { getRouteCatalogEntry } from '@/router/route-catalog'

export type ViewModule = Record<string, Component>
type ViewSubscription = ViewModule | (() => Promise<ViewModule>)

/** Site plugins subscribe their own views when their entry module is imported. */
const siteViewSubscriptions = new Map<SiteProfileId, ViewSubscription>()
const siteEntryLoaders = import.meta.glob('../plugins/sites/*/site.ts')

export const registerSiteViewSubscription = (
  siteId: SiteProfileId,
  views: ViewSubscription,
): void => {
  if (siteViewSubscriptions.has(siteId)) {
    throw new Error(`Duplicate route-view subscription for site "${siteId}".`)
  }
  siteViewSubscriptions.set(siteId, views)
}

export const hasDomainViewLoader = (domain: SiteProfileId): boolean =>
  siteViewSubscriptions.has(domain) ||
  Boolean(siteEntryLoaders[`../plugins/sites/${domain}/site.ts`])

const normalizeViewKey = (value: string): string =>
  value
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/^(?:\.\.\/)+/, '')
    .replace(/^src\//, '')

const resolveView = <T>(views: Record<string, T>, requestedKey: string): T | undefined => {
  const direct = views[requestedKey]
  if (direct) return direct

  const normalizedRequestedKey = normalizeViewKey(requestedKey)
  const matched = Object.entries(views).find(([candidateKey]) => {
    const normalizedCandidateKey = normalizeViewKey(candidateKey)
    return (
      normalizedCandidateKey === normalizedRequestedKey ||
      normalizedCandidateKey.endsWith(`/${normalizedRequestedKey}`)
    )
  })
  return matched?.[1]
}

const loadedDomains = new Map<SiteProfileId, Promise<ViewModule>>()

const getDomainViews = (domain: SiteProfileId): Promise<ViewModule> => {
  const existing = loadedDomains.get(domain)
  if (existing) return existing
  const subscription = siteViewSubscriptions.get(domain)
  if (!subscription) {
    return Promise.reject(
      new Error(`No route-view subscription is registered for site "${domain}".`),
    )
  }
  const loading = Promise.resolve(
    typeof subscription === 'function' ? subscription() : subscription,
  )
  loadedDomains.set(domain, loading)
  return loading
}

export const lazyRouteView = (routeName: string, feature: string, path: string) => async () => {
  const entry = getRouteCatalogEntry(routeName)
  if (!entry || entry.group === 'shared') {
    throw new Error(`Route "${routeName}" has no site-owned domain bundle.`)
  }
  const domain = entry.group
  const viewPath = feature === 'misc' ? path : `${feature}/${path}`
  const views = await getDomainViews(domain)
  const key = `../../views/${viewPath}`
  const view = resolveView(views, key)
  if (view) return { default: view }

  const availableKeys = Object.keys(views).join(', ')
  throw new Error(
    `Unknown ${domain} route view for route "${routeName}". ` +
      `Expected generated or legacy key: ${key}. Available views: ${availableKeys}`,
  )
}

type TaggedLazyView = (() => ReturnType<ReturnType<typeof lazyRouteView>>) & {
  readonly __routeView: { feature: string; path: string }
}

/**
 * Route records are cloned for a concrete site profile after their canonical
 * name is available. Tagging keeps the legacy declarations concise while
 * resolving ownership exclusively through routeCatalog at installation time.
 */
export const lazyFeatureView = (feature: string, path: string): TaggedLazyView => {
  const loader = (() => {
    throw new Error(`Unbound route view requested: ${feature}/${path}`)
  }) as unknown as TaggedLazyView
  Object.defineProperty(loader, '__routeView', { value: { feature, path } })
  return loader
}

/** Keeps a heavy capability outside its domain's eager view registry. */
export const lazyOptionalView = (loader: () => Promise<{ default: Component }>) => loader

export const bindRouteView = <T>(
  routeName: string,
  component: T,
): T | ReturnType<typeof lazyRouteView> => {
  const tagged = component as Partial<TaggedLazyView>
  const routeView = tagged.__routeView
  return routeView ? lazyRouteView(routeName, routeView.feature, routeView.path) : component
}
