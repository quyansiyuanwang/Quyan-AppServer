import { readdir, readFile } from "node:fs/promises"
import path from "node:path"

const testsRoot = path.resolve(process.cwd(), 'tests')
const rules = [
  { directory: 'node', suffix: '.node.test.ts' },
  { directory: 'dom', suffix: '.dom.test.ts' },
]

async function filesIn(directory) {
  const absolute = path.join(testsRoot, directory)
  const entries = await readdir(absolute, { withFileTypes: true })
  const nested = await Promise.all(entries.map((entry) => {
    const target = path.join(absolute, entry.name)
    return entry.isDirectory() ? filesIn(path.relative(testsRoot, target)) : Promise.resolve([target])
  }))
  return nested.flat()
}

const errors = []
for (const rule of rules) {
  for (const file of await filesIn(rule.directory)) {
    if (!file.endsWith('.test.ts')) continue
    const relative = path.relative(testsRoot, file).replaceAll('\\', '/')
    if (!relative.endsWith(rule.suffix)) errors.push(`${relative} must end with ${rule.suffix}`)

    if (rule.directory === 'node') {
      const content = await readFile(file, 'utf8')
      if (/from\s+['"]@vue\/test-utils['"]/u.test(content) || /\b(window|document|localStorage|sessionStorage|MouseEvent)\b/u.test(content))
        errors.push(`${relative} requires DOM APIs and belongs in tests/dom`)
    }

    if (rule.directory === 'dom') {
      const content = await readFile(file, 'utf8')
      if (!content.startsWith('// @vitest-environment jsdom'))
        errors.push(`${relative} must declare the jsdom environment on its first line`)
    }
  }
}

if (errors.length > 0) {
  console.error(`Test taxonomy validation failed:\n${errors.map((error) => `- ${error}`).join('\n')}`)
  process.exit(1)
}

console.log('Test taxonomy is valid.')
