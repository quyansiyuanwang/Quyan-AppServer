import { spawn } from 'node:child_process'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptPath = fileURLToPath(import.meta.url)
const projectRoot = dirname(dirname(scriptPath))
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

let activeChild = null
let teardownPromise = null
let setupCompleted = false
let shutdownRequested = false

const runPnpm = (arguments_) =>
  new Promise((resolve) => {
    const child = spawn(pnpmCommand, arguments_, {
      cwd: projectRoot,
      stdio: 'inherit',
    })
    activeChild = child

    child.once('error', (error) => {
      console.error(`[local-lifecycle] Failed to start pnpm: ${error.message}`)
      if (activeChild === child) activeChild = null
      resolve(1)
    })
    child.once('close', (code) => {
      if (activeChild === child) activeChild = null
      resolve(code ?? 1)
    })
  })

const teardown = async () => {
  if (!setupCompleted) return 0
  if (!teardownPromise) {
    console.log('[local-lifecycle] Tearing down local domains and certificates...')
    teardownPromise = runPnpm(['run', 'local:teardown'])
  }
  return teardownPromise
}

const requestShutdown = (signal) => {
  if (shutdownRequested) return
  shutdownRequested = true
  console.log(`[local-lifecycle] Received ${signal}; stopping development services...`)
  activeChild?.kill(signal)
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.once(signal, () => requestShutdown(signal))
}

const main = async () => {
  console.log('[local-lifecycle] Setting up local domains and HTTPS certificates...')
  const setupExitCode = await runPnpm(['run', 'local:setup'])
  if (setupExitCode !== 0) {
    process.exitCode = setupExitCode
    return
  }

  setupCompleted = true
  if (shutdownRequested) {
    process.exitCode = await teardown()
    return
  }

  console.log('[local-lifecycle] Starting backend, frontend, and docs services...')
  const devExitCode = await runPnpm([
    'exec',
    'concurrently',
    '--kill-others-on-fail',
    '--names',
    'backend,frontend,docs',
    'pnpm --filter @appserver/backend dev',
    'pnpm --filter @appserver/frontend dev',
    'pnpm --filter @appserver/docs-site dev',
  ])
  const teardownExitCode = await teardown()

  process.exitCode = teardownExitCode || (shutdownRequested ? 0 : devExitCode)
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.stack || error.message : error)
  const teardownExitCode = await teardown()
  process.exitCode = teardownExitCode || 1
})
