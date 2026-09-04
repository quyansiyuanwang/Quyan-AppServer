import path from 'node:path'
import type { ChangeMode, GitImpact, ImpactDomain, ImpactRisk } from './types.js'
import { runCommand } from './command.js'

const VALID_REF_RANGE = /^[A-Za-z0-9_./@{}~-]+(?:\.\.?[A-Za-z0-9_./@{}~-]+)?$/

function splitNul(value: string): string[] {
  return value
    .split('\0')
    .filter(Boolean)
    .map((file) => file.replace(/\\/g, '/'))
}

function classifyFiles(files: string[]): {
  domains: ImpactDomain[]
  risks: ImpactRisk[]
  suggestedSkills: string[]
} {
  const domains = new Set<ImpactDomain>()
  const risks = new Set<ImpactRisk>()
  const skills = new Set<string>()

  for (const file of files) {
    if (file.startsWith('apps/backend/')) {
      domains.add('backend')
      skills.add('appserver-backend-development')
    }
    if (file.startsWith('apps/frontend/')) {
      domains.add('frontend')
      skills.add('appserver-frontend-development')
    }
    if (file.startsWith('apps/cli-native/')) {
      domains.add('cli')
      skills.add('appserver-contracts')
      skills.add('appserver-testing-ci')
    }
    if (file.startsWith('packages/')) {
      domains.add('shared')
      skills.add('appserver-contracts')
    }
    if (file.startsWith('docs/') || file.endsWith('.md')) domains.add('docs')
    if (file.startsWith('.github/') || file.startsWith('scripts/')) domains.add('ci')
    if (
      file.includes('/tests/') ||
      file.startsWith('apps/backend/tests/') ||
      file.startsWith('apps/frontend/tests/')
    ) {
      domains.add('tests')
      skills.add('appserver-testing-ci')
    }
    if (file.startsWith('.agents/skills/')) {
      domains.add('skills')
      skills.add('appserver-skill-authoring')
    }
    if (file.startsWith('apps/backend/src/api/') || file.includes('/dto/')) {
      risks.add('openapi')
      skills.add('appserver-contracts')
    }
    if (
      file === 'apps/backend/prisma/schema.prisma' ||
      file.startsWith('apps/backend/prisma/migrations/')
    ) {
      risks.add('database')
      skills.add('appserver-backend-development')
    }
    if (
      file.includes('permission') ||
      file.includes('auth') ||
      file.includes('security') ||
      file === 'SECURITY.md' ||
      file.startsWith('.husky/')
    ) {
      risks.add('security')
      skills.add('appserver-security')
    }
    if (file.startsWith('apps/frontend/src/client/') || file.endsWith('swagger.json')) {
      risks.add('generated-client')
      skills.add('appserver-contracts')
    }
  }

  return {
    domains: [...domains].sort(),
    risks: [...risks].sort(),
    suggestedSkills: [...skills].sort(),
  }
}

async function changedFiles(root: string, mode: ChangeMode, refRange?: string): Promise<string[]> {
  if (mode === 'working-tree') {
    const [tracked, untracked] = await Promise.all([
      runCommand('git', ['diff', '--name-only', '-z'], root, 30_000),
      runCommand('git', ['ls-files', '--others', '--exclude-standard', '-z'], root, 30_000),
    ])
    return [...new Set([...splitNul(tracked.stdout), ...splitNul(untracked.stdout)])].sort()
  }
  if (mode === 'staged') {
    const result = await runCommand('git', ['diff', '--cached', '--name-only', '-z'], root, 30_000)
    return splitNul(result.stdout).sort()
  }
  if (!refRange || !VALID_REF_RANGE.test(refRange) || refRange.startsWith('-')) {
    throw new Error('ref-range 模式需要安全的 Git revision 或 revision range')
  }
  const result = await runCommand('git', ['diff', '--name-only', '-z', refRange], root, 30_000)
  if (result.exitCode !== 0) throw new Error(result.stderr || '无法读取 Git ref range')
  return splitNul(result.stdout).sort()
}

export async function getGitImpact(
  root: string,
  mode: ChangeMode,
  refRange?: string,
): Promise<GitImpact> {
  const [files, branchResult] = await Promise.all([
    changedFiles(root, mode, refRange),
    runCommand('git', ['branch', '--show-current'], root, 30_000),
  ])
  const classification = classifyFiles(files)

  return {
    mode,
    branch: branchResult.exitCode === 0 ? branchResult.stdout.trim() || null : null,
    files,
    ...classification,
  }
}

export function suggestScope(files: string[]): string | undefined {
  const candidates = [
    ['apps/backend/src/api/controllers/v1/relay/', 'relay'],
    ['apps/backend/src/api/controllers/v1/chat/', 'chat'],
    ['apps/frontend/src/', 'frontend'],
    ['apps/cli-native/', 'cli'],
    ['apps/backend/', 'backend'],
    ['packages/shared/', 'shared'],
    ['.github/', 'ci'],
    ['docs/', 'docs'],
  ] as const
  return candidates.find(([prefix]) => files.some((file) => file.startsWith(prefix)))?.[1]
}

export function assertTestPath(
  root: string,
  target: string,
  application: 'backend' | 'frontend',
): string {
  const normalized = target.replace(/\\/g, '/')
  const expectedPrefix = 'apps/' + application + '/tests/'
  const repositoryPath = normalized.startsWith(expectedPrefix)
    ? normalized
    : normalized.startsWith('tests/')
      ? 'apps/' + application + '/' + normalized
      : expectedPrefix + normalized
  const suffix =
    application === 'backend'
      ? /\.(unit|db|integration|contract)\.test\.ts$/
      : /\.(node|dom)\.test\.ts$/
  if (
    !repositoryPath.startsWith(expectedPrefix) ||
    !suffix.test(repositoryPath) ||
    repositoryPath.split('/').includes('..') ||
    path.isAbsolute(normalized)
  ) {
    throw new Error('精确测试路径不在允许的测试目录或后缀范围内')
  }
  return repositoryPath
}
