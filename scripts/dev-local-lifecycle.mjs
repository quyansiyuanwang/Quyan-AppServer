// Multi-domain local development: `*.qysyw.test` hosts plus the generated HTTPS
// certificate. Requires mkcert and (on first run) permission to edit the hosts
// file; repeated runs reuse the existing configuration without prompting.
//
// This is the default `pnpm run dev` target. The privilege-free single-site
// alternative is `pnpm run dev:localhost`.

import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findBusyPorts, resolvePnpmInvocation, spawnForeground } from './lib/platform.mjs'
import { LOCAL_DEV_PORTS } from './lib/dev-provision.mjs'
import { resolveLocalRootDomain } from './lib/dev-env.mjs'

const DEFAULT_PORTS = Object.values(LOCAL_DEV_PORTS)

const scriptPath = fileURLToPath(import.meta.url)
const projectRoot = dirname(dirname(scriptPath))
const require = createRequire(import.meta.url)
const concurrentlyCli = join(
  dirname(require.resolve('concurrently/package.json')),
  'dist',
  'bin',
  'concurrently.js',
)
const localDomainsScript = join(projectRoot, 'scripts', 'setup-local-domains.mjs')

const forwardedArguments = process.argv.slice(2)
const invocation = resolvePnpmInvocation()
const quote = (value) => (value.includes(' ') ? `"${value}"` : value)
const pnpmCommand = (arguments_) =>
  [quote(invocation.command), ...invocation.arguments, ...arguments_].map(quote).join(' ')

const main = async () => {
  console.log('[local-lifecycle] 准备本地域名与 HTTPS 证书…')
  const setupExitCode = await spawnForeground(
    process.execPath,
    [localDomainsScript, ...forwardedArguments],
    { shell: false },
  )
  if (setupExitCode !== 0) {
    process.exitCode = setupExitCode
    return
  }

  console.log('[local-lifecycle] 启动 backend、frontend 与 docs-site…')
  console.log(
    '[local-lifecycle] 退出后 hosts 记录与证书会保留，需要清理时执行 pnpm run local:teardown。',
  )
  console.log(
    `[local-lifecycle] 多域名入口：https://<站点前缀>.${resolveLocalRootDomain()}:${LOCAL_DEV_PORTS.frontend}/` +
      '（按 hostname 区分站点，清单见 docs/development/16-local-development.md）',
  )
  console.log('[local-lifecycle] 免特权单站点模式（无需 mkcert/管理员）请改用 pnpm run dev:localhost。')

  const exitCode = await spawnForeground(
    process.execPath,
    [
      concurrentlyCli,
      '--kill-others-on-fail',
      '--names',
      'backend,frontend,docs',
      '--prefix-colors',
      'blue,green,magenta',
      pnpmCommand(['--filter', '@quyan/backend', 'run', 'dev']),
      pnpmCommand(['--filter', '@quyan/frontend', 'run', 'dev']),
      pnpmCommand(['--filter', '@quyan/docs-site', 'run', 'dev']),
    ],
    { shell: false },
  )

  const leftover = await findBusyPorts(DEFAULT_PORTS)
  if (leftover.length) {
    console.warn(
      `[local-lifecycle] 以下端口仍被占用：${leftover.join(', ')}；` +
        (process.platform === 'win32'
          ? `可用 netstat -ano | findstr :${leftover[0]} 与 taskkill /T /F /PID <PID> 清理。`
          : `可用 lsof -i :${leftover[0]} 清理。`),
    )
  }

  process.exitCode = exitCode
}

await main()
