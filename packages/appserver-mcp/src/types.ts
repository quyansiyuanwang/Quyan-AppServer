export const CHANGE_MODES = ['working-tree', 'staged', 'ref-range'] as const
export type ChangeMode = (typeof CHANGE_MODES)[number]

export const COMMIT_TYPES = [
  'feat',
  'fix',
  'refactor',
  'docs',
  'test',
  'ci',
  'build',
  'chore',
  'style',
  'perf',
  'revert',
] as const
export type CommitType = (typeof COMMIT_TYPES)[number]

export type ImpactDomain =
  | 'backend'
  | 'frontend'
  | 'cli'
  | 'shared'
  | 'docs'
  | 'ci'
  | 'tests'
  | 'skills'

export type ImpactRisk = 'openapi' | 'database' | 'security' | 'generated-client'

export interface GitImpact {
  mode: ChangeMode
  branch: string | null
  files: string[]
  domains: ImpactDomain[]
  risks: ImpactRisk[]
  suggestedSkills: string[]
}

export interface CommandResult {
  command: string
  args: string[]
  exitCode: number
  durationMs: number
  stdout: string
  stderr: string
  stdoutTruncated: boolean
  stderrTruncated: boolean
  timedOut: boolean
}
