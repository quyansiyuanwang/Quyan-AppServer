import type { Component } from 'vue'
import type { SiteProfileId } from '@/config/site-registry'
import { getRouteCatalogEntry } from '@/router/route-catalog'

type ViewModule = Record<string, Component>
type ViewModuleLoader = () => Promise<{ default: ViewModule }>

/**
 * Domain loaders are plugins, not a hand-maintained central registry. Adding
 * a site's `domain-views/<site-id>.ts` module registers it automatically;
 * underscores in a profile id map to URL-safe dashes in the filename.
 */
const domainViewPlugins = import.meta.glob<{ default: ViewModule }>('./domain-views/*.ts')

const getDomainViewPlugin = (domain: SiteProfileId): ViewModuleLoader | undefined =>
  domainViewPlugins[`./domain-views/${domain.replace(/_/g, '-')}.ts`]

export const hasDomainViewLoader = (domain: SiteProfileId): boolean =>
  Boolean(getDomainViewPlugin(domain))

const loadedDomains = new Map<SiteProfileId, Promise<ViewModule>>()

const loadDomain = async (domain: SiteProfileId): Promise<ViewModule> => {
  const loader = getDomainViewPlugin(domain)
  if (!loader) throw new Error(`No route-view loader is registered for site "${domain}".`)
  return (await loader()).default
}

const getDomainViews = (domain: SiteProfileId): Promise<ViewModule> => {
  const existing = loadedDomains.get(domain)
  if (existing) return existing
  const loading = loadDomain(domain)
  loadedDomains.set(domain, loading)
  return loading
}

export const lazyRouteView = (routeName: string, feature: string, path: string) => async () => {
  const entry = getRouteCatalogEntry(routeName)
  if (!entry || entry.group === 'shared') {
    throw new Error(`Route "${routeName}" has no site-owned domain bundle.`)
  }
  const domain = entry.group
  const views = await getDomainViews(domain)
  const key = `../../views/${feature === 'misc' ? path : `${feature}/${path}`}`
  const view = views[key]
  if (!view) throw new Error(`Unknown ${domain} route view: ${key}`)
  return { default: view }
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
