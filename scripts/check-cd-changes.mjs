import { execSync } from 'child_process'

const APP_PATTERNS = {
  frontend: [/^apps\/frontend\//, /^packages\//],
  backend: [/^apps\/backend\//, /^packages\//],
  docs: [/^apps\/docs-site\//],
}

const app = process.argv[2]
const mode = process.argv[3]
const strict = mode === '--strict'
if (!app || !APP_PATTERNS[app] || (mode && !strict)) {
  console.error(
    `Usage: node scripts/check-cd-changes.mjs <${Object.keys(APP_PATTERNS).join('|')}> [--strict]`,
  )
  process.exit(2)
}

let changedFiles
try {
  execSync('git rev-parse HEAD~1', { encoding: 'utf8', stdio: 'ignore' })
  changedFiles = execSync('git diff --name-only HEAD~1 HEAD', { encoding: 'utf8' }).trim()
} catch {
  // Initial, single-commit, and shallow checkouts may not have HEAD~1.
  try {
    changedFiles = execSync('git diff-tree --root --no-commit-id --name-only -r HEAD', {
      encoding: 'utf8',
    }).trim()
  } catch {
    changedFiles = null
  }
}

const patterns = APP_PATTERNS[app]
const files = changedFiles ? changedFiles.split('\n').filter(Boolean) : []
const hasChanges = files.some((file) => patterns.some((re) => re.test(file)))

if (hasChanges) {
  console.log(`CD change check (${app}): matching files found.`)
  process.exit(0)
}

const reason =
  changedFiles === null ? 'unable to determine the Git diff' : 'no matching files found'
if (strict) {
  console.error(`CD change check (${app}): ${reason}.`)
  process.exit(1)
}

// EdgeOne invokes this command as part of its install command. A missing
// path match must not prevent dependency installation and the later build.
console.log(`CD change check (${app}): ${reason}; continuing.`)
process.exit(0)
