#!/usr/bin/env node

/**
 * Runs only Vitest files reachable from the files changed in a PR.
 *
 * GitHub Actions passes dorny/paths-filter's JSON file list as one argument so
 * paths with spaces cannot be split accidentally. The process deliberately
 * succeeds when no test imports a changed implementation file: API/schema and
 * infrastructure changes are handled by their explicit CI suites instead.
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const [workspace, sourcePrefix, changedFilesJson] = process.argv.slice(2)

if (!workspace || !sourcePrefix || !changedFilesJson) {
  console.error('Usage: run-related-vitest.mjs <workspace> <source-prefix> <changed-files-json>')
  process.exit(2)
}

let changedFiles
try {
  changedFiles = JSON.parse(changedFilesJson)
} catch {
  console.error('Changed file list must be a JSON array')
  process.exit(2)
}

if (!Array.isArray(changedFiles)) {
  console.error('Changed file list must be a JSON array')
  process.exit(2)
}

const normalizedPrefix = `${sourcePrefix.replace(/[\\/]+$/, '')}/`
const relatedFiles = changedFiles
  .filter((file) => typeof file === 'string' && file.startsWith(normalizedPrefix))
  .map((file) => path.posix.normalize(file.slice(normalizedPrefix.length)))

if (relatedFiles.length === 0) {
  console.log(`[related-vitest] No files under ${normalizedPrefix}; skipping.`)
  process.exit(0)
}

console.log(`[related-vitest] Resolving tests related to ${relatedFiles.length} changed file(s).`)
const backendWorkspace = path.posix.normalize(workspace).endsWith('apps/backend')
const selectedProjects = String(process.env.VITEST_PROJECT_SELECTOR || '')
  .split(',')
  .map((project) => project.trim())
  .filter(Boolean)
const projectArgs = selectedProjects.flatMap((project) => ['--project', project])
const command = backendWorkspace
  ? ['--filter', '@quyan/backend', 'run', 'test:related', ...projectArgs, ...relatedFiles]
  : ['exec', 'vitest', 'related', '--run', '--passWithNoTests', ...relatedFiles]

const result = spawnSync('pnpm', command, {
  cwd: workspace,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

if (result.error) {
  console.error(result.error)
  process.exit(1)
}
process.exit(result.status ?? 1)
