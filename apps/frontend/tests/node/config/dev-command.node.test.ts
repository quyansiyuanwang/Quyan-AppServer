import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * `pnpm run dev` is the multi-domain HTTPS entry point and `pnpm run dev:localhost`
 * is the privilege-free single-site one. Keeping the mapping in the root manifest
 * alone is not enough: a renamed target silently changes which topology the
 * developer gets, so the scripts and the frontend commands they drive are locked
 * here as well.
 */
const frontendRoot = resolve(import.meta.dirname, '../../..')
const repositoryRoot = resolve(frontendRoot, '..', '..')

const readJson = (path: string) =>
  JSON.parse(readFileSync(resolve(repositoryRoot, path), 'utf8')) as {
    scripts?: Record<string, string>
  }

const readSource = (path: string) => readFileSync(resolve(repositoryRoot, path), 'utf8')

const MULTI_DOMAIN_SCRIPT = 'node scripts/dev-local-lifecycle.mjs'
const SINGLE_SITE_SCRIPT = 'node scripts/dev-local.mjs'

describe('local development commands', () => {
  it('keeps the default dev command on the multi-domain topology', () => {
    const { scripts } = readJson('package.json')

    expect(scripts?.dev).toBe(MULTI_DOMAIN_SCRIPT)
    expect(scripts?.['dev:domains']).toBe(MULTI_DOMAIN_SCRIPT)
    expect(scripts?.['dev:local-lifecycle']).toBe(MULTI_DOMAIN_SCRIPT)
  })

  it('keeps the single-site mode behind an explicit opt-in command', () => {
    const { scripts } = readJson('package.json')

    expect(scripts?.['dev:localhost']).toBe(SINGLE_SITE_SCRIPT)
  })

  it('drives the matching frontend command from each topology script', () => {
    const multiDomain = readSource('scripts/dev-local-lifecycle.mjs')
    const singleSite = readSource('scripts/dev-local.mjs')

    expect(multiDomain).toContain("'@quyan/frontend', 'run', 'dev'")
    // The multi-domain script may name the single-site command in a hint, but it
    // must never spawn it.
    expect(multiDomain).not.toContain("'@quyan/frontend', 'run', 'dev:localhost'")
    expect(singleSite).toContain("'@quyan/frontend', 'run', 'dev:localhost'")
  })

  it('injects the host-scoped session overrides only for the single-site mode', () => {
    const singleSite = readSource('scripts/dev-local.mjs')
    const multiDomain = readSource('scripts/dev-local-lifecycle.mjs')

    // The overrides empty the three cookie domains for a localhost origin, which
    // would break the domain-level cookies the multi-domain topology relies on.
    expect(singleSite).toContain('scripts/dev-local-backend.mjs')
    expect(multiDomain).not.toContain('dev-local-backend')
  })

  it('keeps each frontend dev command bound to its topology', () => {
    const { scripts } = readJson('apps/frontend/package.json')

    expect(scripts?.dev).toContain('vite')
    expect(scripts?.dev).not.toContain('--mode localhost')
    expect(scripts?.['dev:localhost']).toContain('vite --mode localhost')
  })

  it('resolves the local root domain from one shared source', () => {
    // The hosts/certificate setup and the startup hint must not carry separate
    // copies of the qysyw.test default.
    expect(readSource('scripts/setup-local-domains.mjs')).toContain('resolveLocalRootDomain')
    expect(readSource('scripts/lib/dev-env.mjs')).toContain('export const resolveLocalRootDomain')
  })
})
