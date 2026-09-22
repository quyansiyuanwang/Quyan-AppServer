// Environment file handling for local development: template parsing, generated
// development secrets, and drift detection. Existing files are never overwritten.

import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { appRoots } from './platform.mjs'

/**
 * Secrets the backend refuses to start without, plus the keys whose placeholder
 * values must never be shared between environments. Each one is replaced with an
 * independent random value.
 */
export const generatedSecretKeys = [
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'REPLAY_SIGNING_MASTER_SECRET',
  'TWO_FACTOR_TRUSTED_DEVICE_SECRET',
  'DEVELOPER_SECRETS_MASTER_KEY',
  'RELAY_CHANNEL_PROBE_MASTER_KEY',
  'RELAY_CHANNEL_CHANGE_REQUEST_MASTER_KEY',
  'SUPPORT_AI_CONFIG_MASTER_SECRET',
  'RTM_INSTALL_TOKEN_SECRET',
]

/** Keys required for the backend to boot; reported when an existing .env lacks them. */
export const requiredBackendKeys = [
  'DATABASE_URL',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'REPLAY_SIGNING_MASTER_SECRET',
]

const LOCAL_ROOT_DOMAIN_KEY = 'ROOT_DOMAIN'
export const DEFAULT_LOCAL_ROOT_DOMAIN = 'qysyw.test'

/**
 * The local `.test` root domain used by the multi-domain HTTPS mode. Both the
 * hosts/certificate setup and the startup hints resolve it here, so the default
 * lives in exactly one place.
 */
export const resolveLocalRootDomain = (value = process.env.LOCAL_ROOT_DOMAIN) =>
  String(value ?? '')
    .trim()
    .toLowerCase() || DEFAULT_LOCAL_ROOT_DOMAIN

export function parseEnvContent(content) {
  const values = new Map()
  for (const rawLine of String(content).split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const normalized = line.startsWith('export ') ? line.slice(7).trim() : line
    const separator = normalized.indexOf('=')
    if (separator <= 0) continue
    const key = normalized.slice(0, separator).trim()
    const rawValue = normalized.slice(separator + 1).trim()
    values.set(key, rawValue.replace(/^(['"])(.*)\1$/, '$2'))
  }
  return values
}

export async function readEnvValues(filePath) {
  if (!existsSync(filePath)) return new Map()
  return parseEnvContent(await readFile(filePath, 'utf8'))
}

export function createDevelopmentSecret() {
  return `dev-${randomBytes(32).toString('hex')}`
}

/**
 * Substitutes placeholder secret values in a template and scopes the shared
 * session cookies to the local multi-domain family. Returning the content keeps
 * this function pure enough to reason about from the caller.
 */
export function buildDevelopmentEnvContent(templateContent) {
  const replaced = []
  let content = String(templateContent).replace(/\r\n/g, '\n')

  for (const key of generatedSecretKeys) {
    const expression = new RegExp(`^${key}=.*$`, 'm')
    if (!expression.test(content)) continue
    content = content.replace(expression, `${key}=${createDevelopmentSecret()}`)
    replaced.push(key)
  }

  const values = parseEnvContent(content)
  const rootDomain = values.get(LOCAL_ROOT_DOMAIN_KEY) || DEFAULT_LOCAL_ROOT_DOMAIN
  const cookieDomain = `${rootDomain}`.split('.').length >= 2 ? `.${rootDomain}` : ''

  if (cookieDomain) {
    const expression = /^AUTH_REFRESH_COOKIE_DOMAIN=.*$/m
    const line = `AUTH_REFRESH_COOKIE_DOMAIN=${cookieDomain}`
    content = expression.test(content)
      ? content.replace(expression, line)
      : `${content.trimEnd()}\n${line}\n`
  }

  return { content, replaced, cookieDomain }
}

export const envTargets = [
  { directory: appRoots.backend, label: 'apps/backend', generateSecrets: true },
  { directory: appRoots.frontend, label: 'apps/frontend', generateSecrets: false },
  { directory: appRoots.docs, label: 'apps/docs-site', generateSecrets: false },
]

export function envPathsFor(target) {
  return {
    templatePath: join(target.directory, '.env.example'),
    envPath: join(target.directory, '.env'),
  }
}

/**
 * Creates missing `.env` files from their committed templates.
 * `write: false` turns this into a read-only report for `doctor`.
 * `force` backs up an existing file before regenerating it.
 */
export async function ensureEnvFiles({ write, force = false }) {
  const results = []

  for (const target of envTargets) {
    const { templatePath, envPath } = envPathsFor(target)
    const templateExists = existsSync(templatePath)
    let envExists = existsSync(envPath)

    if (!templateExists) {
      results.push({ target, status: 'fail', message: `${target.label}/.env.example 缺失` })
      continue
    }

    if (envExists && force && write) {
      const backupPath = `${envPath}.bak`
      await rename(envPath, backupPath)
      results.push({
        target,
        status: 'warn',
        message: `${target.label}/.env 已备份为 .env.bak 并重新生成`,
      })
      envExists = false
    }

    if (envExists) {
      const values = await readEnvValues(envPath)
      const missing = requiredBackendKeys.filter(
        (key) => target.generateSecrets && !values.get(key),
      )
      if (missing.length) {
        results.push({
          target,
          status: 'warn',
          message: `${target.label}/.env 缺少必需键：${missing.join(', ')}`,
          hint: `请在 ${target.label}/.env 中补全上述键（可参考 .env.example），脚本不会覆盖已有文件。`,
        })
      } else {
        results.push({ target, status: 'pass', message: `${target.label}/.env 已存在` })
      }
      continue
    }

    if (!write) {
      results.push({
        target,
        status: 'warn',
        message: `${target.label}/.env 未创建`,
        hint: '运行 pnpm run setup 生成（从 .env.example 复制并填充随机开发密钥）。',
      })
      continue
    }

    const templateContent = await readFile(templatePath, 'utf8')
    const { content, replaced, cookieDomain } = target.generateSecrets
      ? buildDevelopmentEnvContent(templateContent)
      : { content: templateContent, replaced: [], cookieDomain: '' }
    await writeFile(envPath, content, 'utf8')

    const detail = target.generateSecrets
      ? `已生成随机开发密钥：${replaced.length} 项；AUTH_REFRESH_COOKIE_DOMAIN=${cookieDomain || '(空)'}`
      : '已从 .env.example 复制'
    results.push({
      target,
      status: 'pass',
      message: `已创建 ${target.label}/.env`,
      detail,
    })
  }

  return results
}
