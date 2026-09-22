// Cross-platform process and network helpers for the local development scripts.

import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import net from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const isWindows = process.platform === 'win32'

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

export const appRoots = {
  backend: join(projectRoot, 'apps', 'backend'),
  frontend: join(projectRoot, 'apps', 'frontend'),
  docs: join(projectRoot, 'apps', 'docs-site'),
}

const quoteArgument = (value) => (/\s/.test(value) ? `"${value}"` : value)

/** Builds a single shell command line; Node deprecates args arrays with `shell: true`. */
export const buildCommandLine = (command, arguments_ = []) =>
  [command, ...arguments_].map(quoteArgument).join(' ')

/**
 * Resolves how child processes invoke pnpm.
 *
 * `npm_execpath` is deliberately not used: an inherited or stale value can point
 * at a different pnpm (for example a corepack shim), which then fails the
 * project's `packageManager` version check. The PATH pnpm is the same binary the
 * developer typed, so child invocations behave like the documented commands.
 */
export function resolvePnpmInvocation() {
  return { command: isWindows ? 'pnpm.cmd' : 'pnpm', arguments: [], shell: isWindows }
}

export function resolveConcurrentlyCli() {
  const require = createRequire(import.meta.url)
  return join(dirname(require.resolve('concurrently/package.json')), 'dist', 'bin', 'concurrently.js')
}

/** Spawns synchronously, through a shell only when the caller asks for it. */
export function runProcess(command, arguments_ = [], { shell = false, ...options } = {}) {
  const result = shell
    ? spawnSync(buildCommandLine(command, arguments_), {
        cwd: projectRoot,
        stdio: 'inherit',
        shell: true,
        ...options,
      })
    : spawnSync(command, arguments_, {
        cwd: projectRoot,
        stdio: 'inherit',
        shell: false,
        ...options,
      })
  return result.status ?? 1
}

export function runPnpm(arguments_, options = {}) {
  const invocation = resolvePnpmInvocation()
  return runProcess(invocation.command, [...invocation.arguments, ...arguments_], {
    shell: invocation.shell,
    ...options,
  })
}

export function captureCommand(command, arguments_ = [], options = {}) {
  const result = spawnSync(command, arguments_, {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    ...options,
  })
  if (result.error || result.status !== 0) return null
  return String(result.stdout ?? '').trim()
}

/** Resolves a version string without a shell, falling back to the platform shim. */
export function commandVersion(command, arguments_ = ['--version']) {
  const direct = captureCommand(command, arguments_)
  if (direct) return direct.split(/\r?\n/)[0]?.trim() || null

  const shim = isWindows ? `${command}.cmd` : command
  const result = spawnSync(buildCommandLine(shim, arguments_), {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  })
  if (result.error || result.status !== 0) return null
  return String(result.stdout ?? '').trim().split(/\r?\n/)[0]?.trim() || null
}

/** Attempts a TCP connection; resolves true when something is listening. */
export function isTcpReachable(host, port, timeoutMs = 1200) {
  return new Promise((resolvePromise) => {
    const socket = new net.Socket()
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolvePromise(value)
    }

    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
    socket.connect(Number(port), host)
  })
}

export async function findBusyPorts(ports, host = '127.0.0.1') {
  const busy = []
  for (const port of ports) {
    if (await isTcpReachable(host, port, 400)) busy.push(port)
  }
  return busy
}

/**
 * Stops a child together with its descendants.
 *
 * Killing only the direct child leaves grandchildren (pnpm -> nodemon -> bun,
 * or concurrently -> vite) running on Windows, which keeps dev ports occupied
 * after Ctrl+C or a parent-process termination.
 */
export function terminateProcessTree(child) {
  if (!child || child.pid === undefined) return
  if (child.exitCode !== null || child.signalCode !== null) return

  if (isWindows) {
    spawnSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], { stdio: 'ignore' })
    return
  }

  try {
    // The child is spawned detached, so it leads its own process group.
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    try {
      child.kill('SIGTERM')
    } catch {
      // The child already exited.
    }
  }
}

/** Spawns a child with inherited stdio and forwards termination signals. */
export function spawnForeground(command, arguments_, { env, shell = false } = {}) {
  const spawnOptions = {
    cwd: projectRoot,
    stdio: 'inherit',
    // A detached POSIX child leads its own process group, which makes the
    // group-wide termination above possible. Windows uses the process tree.
    detached: !isWindows,
    env: env ? { ...process.env, ...env } : process.env,
  }

  const child = shell
    ? spawn(buildCommandLine(command, arguments_), { ...spawnOptions, shell: true })
    : spawn(command, arguments_, { ...spawnOptions, shell: false })

  const forward = (signal) => {
    console.log(`\n[dev] 收到 ${signal}，正在停止子进程…`)
    terminateProcessTree(child)
  }
  const signalHandlers = new Map(
    ['SIGINT', 'SIGTERM', 'SIGHUP'].map((signal) => [signal, () => forward(signal)]),
  )
  for (const [signal, handler] of signalHandlers) process.once(signal, handler)

  return new Promise((resolvePromise) => {
    const cleanup = () => {
      for (const [signal, handler] of signalHandlers) process.removeListener(signal, handler)
    }

    child.once('error', (error) => {
      cleanup()
      console.error(`[dev] 无法启动进程：${error.message}`)
      resolvePromise(1)
    })
    child.once('close', (code, signal) => {
      cleanup()
      resolvePromise(signal ? 0 : (code ?? 1))
    })
  })
}
