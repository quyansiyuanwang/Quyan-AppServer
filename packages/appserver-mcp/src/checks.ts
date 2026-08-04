import { access } from 'node:fs/promises'
import path from 'node:path'
import { runCommand } from './command.js'
import { assertTestPath } from './git.js'
import type { CommandResult } from './types.js'

export const CHECK_PROFILES = [
  'backend-unit',
  'backend-database',
  'backend-integration',
  'backend-contract',
  'backend-runtime',
  'backend-type-check',
  'backend-taxonomy',
  'frontend-node',
  'frontend-dom',
  'frontend-type-check',
  'frontend-taxonomy',
  'lint-check',
  'format-check',
  'backend-quality',
  'frontend-quality',
  'openapi-generate',
  'backend-test-file',
  'frontend-test-file',
] as const
export type CheckProfile = (typeof CHECK_PROFILES)[number]

interface CheckDefinition {
  args: string[]
  timeoutMs: number
  needsTarget?: 'backend' | 'frontend'
}

const CHECKS: Record<
  Exclude<CheckProfile, 'backend-test-file' | 'frontend-test-file'>,
  CheckDefinition
> = {
  'backend-unit': {
    args: ['--filter', '@appserver/backend', 'run', 'test:unit'],
    timeoutMs: 15 * 60_000,
  },
  'backend-database': {
    args: ['--filter', '@appserver/backend', 'run', 'test:database'],
    timeoutMs: 30 * 60_000,
  },
  'backend-integration': {
    args: ['--filter', '@appserver/backend', 'run', 'test:integration'],
    timeoutMs: 30 * 60_000,
  },
  'backend-contract': {
    args: ['--filter', '@appserver/backend', 'run', 'test:contract'],
    timeoutMs: 30 * 60_000,
  },
  'backend-runtime': {
    args: ['--filter', '@appserver/backend', 'run', 'test:runtime'],
    timeoutMs: 30 * 60_000,
  },
  'backend-type-check': {
    args: ['--filter', '@appserver/backend', 'run', 'type-check'],
    timeoutMs: 10 * 60_000,
  },
  'backend-taxonomy': {
    args: ['--filter', '@appserver/backend', 'run', 'test:taxonomy'],
    timeoutMs: 2 * 60_000,
  },
  'frontend-node': {
    args: ['--filter', '@appserver/frontend', 'run', 'test:node'],
    timeoutMs: 15 * 60_000,
  },
  'frontend-dom': {
    args: ['--filter', '@appserver/frontend', 'run', 'test:dom'],
    timeoutMs: 15 * 60_000,
  },
  'frontend-type-check': {
    args: ['--filter', '@appserver/frontend', 'run', 'type-check'],
    timeoutMs: 10 * 60_000,
  },
  'frontend-taxonomy': {
    args: ['--filter', '@appserver/frontend', 'run', 'test:taxonomy'],
    timeoutMs: 2 * 60_000,
  },
  'lint-check': { args: ['run', 'lint:check'], timeoutMs: 15 * 60_000 },
  'format-check': { args: ['run', 'format:check'], timeoutMs: 10 * 60_000 },
  'backend-quality': { args: ['run', 'check:backend'], timeoutMs: 20 * 60_000 },
  'frontend-quality': { args: ['run', 'check:frontend'], timeoutMs: 20 * 60_000 },
  'openapi-generate': { args: ['run', 'openapi:gen:all'], timeoutMs: 20 * 60_000 },
}

export function isCheckProfile(value: string): value is CheckProfile {
  return (CHECK_PROFILES as readonly string[]).includes(value)
}

export async function runCheck(
  root: string,
  profile: CheckProfile,
  target?: string,
): Promise<CommandResult> {
  let definition: CheckDefinition
  if (profile === 'backend-test-file') {
    if (!target) throw new Error('backend-test-file 需要 target')
    const safeTarget = assertTestPath(root, target, 'backend')
    await access(path.join(root, safeTarget))
    definition = {
      args: [
        '--filter',
        '@appserver/backend',
        'run',
        'test',
        '--',
        safeTarget.slice('apps/backend/'.length),
      ],
      timeoutMs: 15 * 60_000,
    }
  } else if (profile === 'frontend-test-file') {
    if (!target) throw new Error('frontend-test-file 需要 target')
    const safeTarget = assertTestPath(root, target, 'frontend')
    await access(path.join(root, safeTarget))
    definition = {
      args: [
        '--filter',
        '@appserver/frontend',
        'run',
        'test',
        '--',
        safeTarget.slice('apps/frontend/'.length),
      ],
      timeoutMs: 15 * 60_000,
    }
  } else {
    definition = CHECKS[profile]
  }
  return runCommand('pnpm', definition.args, root, definition.timeoutMs)
}

export function suggestProfiles(
  domains: string[],
  risks: string[],
): Array<{ profile: CheckProfile; reason: string }> {
  const profiles = new Map<CheckProfile, string>()
  const add = (profile: CheckProfile, reason: string) => profiles.set(profile, reason)

  if (domains.includes('backend')) add('backend-type-check', '后端源码变更')
  if (domains.includes('frontend')) add('frontend-type-check', '前端源码变更')
  if (domains.includes('tests')) add('backend-taxonomy', '测试目录或后缀变更')
  if (domains.includes('shared')) {
    add('backend-type-check', 'shared 契约影响后端')
    add('frontend-type-check', 'shared 契约影响前端')
  }
  if (risks.includes('openapi')) {
    add('openapi-generate', 'Controller 或 DTO 契约变更')
    add('frontend-type-check', '生成 client 可能影响前端')
  }
  if (risks.includes('database')) add('backend-database', 'Prisma schema 或迁移变更')
  if (risks.includes('security')) add('backend-type-check', '认证、权限或 hook 变更')
  if (risks.includes('generated-client')) add('frontend-type-check', '生成 client 变更')
  return [...profiles.entries()].map(([profile, reason]) => ({ profile, reason }))
}
