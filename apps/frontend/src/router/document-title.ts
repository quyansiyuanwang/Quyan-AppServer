import { watch } from 'vue'
import type { RouteLocationNormalized, Router } from 'vue-router'
import { flattenNavigationRoutes, navigationMenuDefinition } from '@/config/navigation-metadata'
import type { SiteProfile } from '@/config/site-registry'
import { i18n, i18ns, localeMessagesVersion, type I18nENAvailableKeys } from '@/locales'

type DocumentTitleKey = I18nENAvailableKeys

const routeTitleKeyByRouteName = new Map<string, DocumentTitleKey>()
for (const { node } of flattenNavigationRoutes(navigationMenuDefinition)) {
  if (node.route) routeTitleKeyByRouteName.set(node.route, node.labelKey as DocumentTitleKey)
}

const routeTitleKeyOverrides = {
  root: 'nav.home',
  indexDirect: 'nav.home',
  login: 'login',
  register: 'register',
  forgotPassword: 'forgotPasswordPage.title',
  authVerification: 'twoFactor.loginTitle',
  captchaVerification: 'loginOrRegisterPage.turnstileCardTitle',
  oauthAuthorize: 'oauthAuthorize.title',
  externalAuthCallback: 'login',
  externalAuthBindStart: 'login',
  qrApproval: 'loginOrRegisterPage.qrApprovalTitle',
  authPasskeyManagement: 'nav.passkeyManagement',
} satisfies Record<string, DocumentTitleKey>

const getTitleKey = (route: Pick<RouteLocationNormalized, 'name' | 'meta'>) => {
  const metaTitleKey = route.meta.titleKey
  if (typeof metaTitleKey === 'string') return metaTitleKey as DocumentTitleKey

  const routeName = typeof route.name === 'string' ? route.name : ''
  return (
    routeTitleKeyOverrides[routeName as keyof typeof routeTitleKeyOverrides] ??
    routeTitleKeyByRouteName.get(routeName)
  )
}

export const resolveDocumentTitle = (
  route: Pick<RouteLocationNormalized, 'name' | 'meta'>,
  profile: Pick<SiteProfile, 'id' | 'labelKey'>,
) => {
  const siteLabel = resolveSafeLabel(profile.labelKey, profile.id)
  const titleKey = getTitleKey(route)
  if (!titleKey) return `Quyan · ${siteLabel}`

  const pageLabel = resolveSafeLabel(titleKey, 'Page')
  return pageLabel === siteLabel ? `Quyan · ${siteLabel}` : `Quyan · ${pageLabel} · ${siteLabel}`
}

const resolveSafeLabel = (key: string, fallback: string) => {
  if (i18n.global.te(key, i18ns.locale)) return i18ns.t(key as DocumentTitleKey)
  if (import.meta.env.DEV) console.warn(`[document-title] Missing translation: ${key}`)
  return fallback === 'Page'
    ? key
        .split('.')
        .slice(-1)[0]!
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/^./, (value: string) => value.toUpperCase())
    : fallback.replace(/[-_]/g, ' ').replace(/^./, (value: string) => value.toUpperCase())
}

export const installDocumentTitle = (router: Router, profile: SiteProfile) => {
  const apply = (route: RouteLocationNormalized) => {
    if (typeof document === 'undefined') return
    document.title = resolveDocumentTitle(route, profile)
  }

  router.afterEach((to) => apply(to))
  watch([i18ns.refer, localeMessagesVersion], () => apply(router.currentRoute.value), {
    flush: 'post',
  })
  apply(router.currentRoute.value)
}
