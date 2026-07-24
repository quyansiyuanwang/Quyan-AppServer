import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

const workspaceRoot = process.cwd()
const backendSource = join(workspaceRoot, 'apps/backend/src')
const allowedRuntimeEnvFile = 'config/env.ts'
const viteBuiltIns = new Set(['BASE_URL', 'MODE', 'DEV'])

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name)
      return entry.isDirectory() ? listFiles(path) : [path]
    }),
  )
  return nested.flat()
}

async function readExampleKeys(appDirectory) {
  const contents = await readFile(join(workspaceRoot, appDirectory, '.env.example'), 'utf8')
  return new Set([...contents.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((match) => match[1]))
}

async function assertExampleCoverage(appDirectory, expression) {
  const files = (await listFiles(join(workspaceRoot, appDirectory, 'src'))).filter((file) => file.endsWith('.ts') || file.endsWith('.vue'))
  const keys = new Set()
  for (const file of files) {
    const contents = await readFile(file, 'utf8')
    for (const match of contents.matchAll(expression)) keys.add(match[1])
  }

  const exampleKeys = await readExampleKeys(appDirectory)
  const missing = [...keys].filter((key) => !viteBuiltIns.has(key) && !exampleKeys.has(key))
  if (missing.length) throw new Error(`${appDirectory}/.env.example is missing: ${missing.join(', ')}`)
}

const backendFiles = (await listFiles(backendSource)).filter((file) => file.endsWith('.ts'))
const violations = []
for (const file of backendFiles) {
  const contents = await readFile(file, 'utf8')
  if (contents.includes('process.env') && relative(backendSource, file).replaceAll('\\', '/') !== allowedRuntimeEnvFile)
    violations.push(relative(workspaceRoot, file))
}
if (violations.length)
  throw new Error(`Runtime process.env access is only allowed in ${allowedRuntimeEnvFile}: ${violations.join(', ')}`)

await assertExampleCoverage('apps/backend', /process\.env\.([A-Z0-9_]+)/g)
await assertExampleCoverage('apps/frontend', /import\.meta\.env\.([A-Z0-9_]+)/g)
await assertExampleCoverage('apps/docs-site', /import\.meta\.env\.([A-Z0-9_]+)/g)
