import { watch } from 'vue'
import type { RouteLocationNormalized, Router } from 'vue-router'
import { flattenNavigationRoutes, navigationMenuDefinition } from '@/config/navigation-catalog'
import type { SiteProfile } from '@/config/site-registry'
import { i18ns, type I18nENAvailableKeys } from '@/locales'

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
  profile: Pick<SiteProfile, 'labelKey'>,
) => {
  const siteLabel = i18ns.t(profile.labelKey as DocumentTitleKey)
  const titleKey = getTitleKey(route)
  if (!titleKey) return `Quyan · ${siteLabel}`

  const pageLabel = i18ns.t(titleKey)
  return pageLabel === siteLabel ? `Quyan · ${siteLabel}` : `Quyan · ${pageLabel} · ${siteLabel}`
}

export const installDocumentTitle = (router: Router, profile: SiteProfile) => {
  const apply = (route: RouteLocationNormalized) => {
    if (typeof document === 'undefined') return
    document.title = resolveDocumentTitle(route, profile)
  }

  router.afterEach((to) => apply(to))
  watch(i18ns.refer, () => apply(router.currentRoute.value), { flush: 'post' })
  apply(router.currentRoute.value)
}
