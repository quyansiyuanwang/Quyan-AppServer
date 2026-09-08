import { ALL_PERMISSIONS, Permission } from './permission'

export type OAuthScopeRiskLevel = 'normal' | 'high'
export type OAuthScopeKind = 'identity' | 'permission' | 'legacy'

export interface OAuthScopeDefinition {
  scope: string
  kind: OAuthScopeKind
  category: string
  riskLevel: OAuthScopeRiskLevel
  legacy: boolean
  requiredPermissions: Permission[]
  labelKey: string
  descriptionKey: string
  categoryKey: string
}

/**
 * Scope names that predate the shared Permission catalog. Keep these aliases
 * stable so an old token continues to satisfy a route that has moved to the
 * canonical permission scope.
 */
export const OAUTH_LEGACY_SCOPE_ALIASES: Readonly<Record<string, readonly string[]>> = {
  profile: [Permission.USER_UPDATE_SELF_PROFILE],
  email: [Permission.USER_UPDATE_SELF_EMAIL],
  notification: [Permission.NOTIFICATION_MANAGE],
  oauth_client: [Permission.OAUTH_CLIENT_READ],
  accesskey: [Permission.ACCESSKEY_READ],
  passkey: [Permission.PASSKEY_MANAGE],
  'relay:usage:read': [Permission.RELAY_TOKEN_READ],
}

export const getOAuthScopeAliases = (scope: string): readonly string[] => {
  const aliases = Object.entries(OAUTH_LEGACY_SCOPE_ALIASES).flatMap(([legacy, canonical]) =>
    legacy === scope || canonical.includes(scope) ? [legacy, ...canonical] : [],
  )
  return [...new Set([scope, ...aliases])]
}

const IDENTITY_SCOPES: readonly OAuthScopeDefinition[] = [
  // Reading the signed-in user's identity is intrinsic to an authenticated
  // account; write endpoints still enforce their dedicated permissions.
  ['profile', 'identity', 'identity', 'normal', []],
  ['email', 'identity', 'identity', 'high', [Permission.USER_UPDATE_SELF_EMAIL]],
  ['notification', 'identity', 'notification', 'normal', [Permission.NOTIFICATION_MANAGE]],
  ['oauth_client', 'identity', 'oauth', 'high', [Permission.OAUTH_CLIENT_READ]],
  ['accesskey', 'identity', 'accesskey', 'high', [Permission.ACCESSKEY_READ]],
  ['passkey', 'identity', 'security', 'high', [Permission.PASSKEY_MANAGE]],
  ['two_factor', 'identity', 'security', 'high', []],
].map(([scope, kind, category, riskLevel, requiredPermissions]) => ({
  scope: scope as string,
  kind: kind as OAuthScopeKind,
  category: category as string,
  riskLevel: riskLevel as OAuthScopeRiskLevel,
  legacy: false,
  requiredPermissions: requiredPermissions as Permission[],
  labelKey: `oauthScopes.scopes.${scope}.label`,
  descriptionKey: `oauthScopes.scopes.${scope}.description`,
  categoryKey: `oauthScopes.categories.${category}`,
}))

const LEGACY_SCOPES: readonly OAuthScopeDefinition[] = [
  {
    scope: 'relay:usage:read',
    kind: 'legacy',
    category: 'relay',
    riskLevel: 'normal',
    legacy: true,
    requiredPermissions: [Permission.RELAY_TOKEN_READ],
    labelKey: 'oauthScopes.legacy.relayUsageRead.label',
    descriptionKey: 'oauthScopes.legacy.relayUsageRead.description',
    categoryKey: 'oauthScopes.categories.relay',
  },
]

const isHighRiskPermission = (scope: string): boolean => {
  return /(?:create|update|delete|manage|write|execute|export|recharge|settle|impersonate|assume_role|custom_key|publish|attach|detach|force_offline|act)/i.test(
    scope,
  ) || /(?:secret|passkey|two_factor|password)/i.test(scope)
}

const permissionDefinitions: readonly OAuthScopeDefinition[] = ALL_PERMISSIONS.map((scope) => {
  const category = scope.split(':')[0] || 'general'
  const key = Object.entries(Permission).find(([, value]) => value === scope)?.[0] ?? scope
  return {
    scope,
    kind: 'permission',
    category,
    riskLevel: isHighRiskPermission(scope) ? 'high' : 'normal',
    legacy: false,
    requiredPermissions: [scope],
    labelKey: `oauthScopes.permissions.${key}.label`,
    descriptionKey: `oauthScopes.permissions.${key}.description`,
    categoryKey: `oauthScopes.categories.${category}`,
  }
})

export const OAUTH_SCOPE_CATALOG: readonly OAuthScopeDefinition[] = [
  ...IDENTITY_SCOPES,
  ...permissionDefinitions,
  ...LEGACY_SCOPES,
]

const scopeMap = new Map(OAUTH_SCOPE_CATALOG.map((definition) => [definition.scope, definition]))

export const getOAuthScopeDefinition = (scope: string) => scopeMap.get(scope)

export const getOAuthScopeCatalog = () => [...OAUTH_SCOPE_CATALOG]

export const isOAuthScopeGrantable = (
  definition: OAuthScopeDefinition,
  effectivePermissions: Iterable<string>,
): boolean => {
  if (definition.requiredPermissions.length === 0) return true
  const effective = new Set(effectivePermissions)
  return definition.requiredPermissions.every((permission) => effective.has(permission))
}

export const isKnownOAuthScope = (scope: string) => scopeMap.has(scope)
