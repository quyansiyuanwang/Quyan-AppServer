/**
 * First-party host prefixes for the local/deployment topologies.
 *
 * This module is loaded by the Vite config, which cannot import the workspace
 * TypeScript package directly, so the product prefixes are listed literally.
 * `tests/node/config/first-party-hosts.node.test.ts` locks them against
 * `DEVELOPER_PRODUCTS` in `@quyan/shared` and against the site catalog, so a new
 * product cannot be registered without this list following along.
 *
 * `legacy` is intentionally absent: the multi-domain dev server does not serve
 * the legacy single-domain build, which runs from its own worktree.
 */
export const platformHostPrefixes = [
  'www',
  'auth',
  'account',
  'chat',
  'terminal',
  'ai.console',
  'developer.console',
  'ram.console',
  'oj.console',
  'management',
  'ai.management',
  'developer.management',
  'terminal.management',
] as const

/** `<DEVELOPER_PRODUCTS[].urlSlug>.console`, in shared catalog order. */
export const productHostPrefixes = [
  'kv.console',
  'short-link.console',
  'secret.console',
  'status.console',
  'verification.console',
  'ip-geolocation.console',
  'push.console',
  'json-endpoints.console',
] as const

export const firstPartyHostPrefixes: readonly string[] = [
  ...platformHostPrefixes,
  ...productHostPrefixes,
]

export const buildFirstPartyHostnames = (rootDomain: string): string[] =>
  firstPartyHostPrefixes.map((prefix) => `${prefix}.${rootDomain}`)
