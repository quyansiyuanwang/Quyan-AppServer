import { execSync } from 'child_process'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..', '..')

function git(cmd) {
  try {
    return execSync(cmd, { cwd: root, encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

export function buildInfoPlugin() {
  const commitHash = git('git rev-parse HEAD')
  const commitHashShort = git('git rev-parse --short HEAD')
  const branch = git('git rev-parse --abbrev-ref HEAD')
  const commitMessage = git('git log -1 --pretty=%s')
  const commitTime = git('git log -1 --pretty=%cI')
  const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
  const buildTime = new Date().toISOString()

  const info = { version, commitHash, commitHashShort, branch, commitMessage, commitTime, buildTime }

  return {
    name: 'vite-plugin-build-info',
    config() {
      return {
        define: {
          __BUILD_INFO__: JSON.stringify(info),
        },
      }
    },
  }
}
