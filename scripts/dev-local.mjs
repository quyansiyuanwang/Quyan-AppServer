// Privilege-free local development: backend + frontend + docs-site on
// plain HTTP localhost. No hosts edit, no certificate, no elevation.
// The multi-domain HTTPS mode stays available through `pnpm run dev:domains`.

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createReporter } from './lib/dev-report.mjs'
import {
  appRoots,
  findBusyPorts,
  projectRoot,
  resolveConcurrentlyCli,
  resolvePnpmInvocation,
  spawnForeground,
} from './lib/platform.mjs'
import { LOCAL_DEV_PORTS, ensurePrismaClient, provisionEnvFiles } from './lib/dev-provision.mjs'
import { LOCAL_DEV_ORIGIN } from './lib/dev-local-env.mjs'

const frontendOrigin = LOCAL_DEV_ORIGIN
const docsOrigin = `http://localhost:${LOCAL_DEV_PORTS.docs}`
const apiOrigin = `http://localhost:${LOCAL_DEV_PORTS.backend}`

const quote = (value) => (value.includes(' ') ? `"${value}"` : value)

/** Reports ports that outlived the dev stack instead of leaving them silent. */
const reportLeftoverPorts = async (reporter) => {
  const leftover = await findBusyPorts(Object.values(LOCAL_DEV_PORTS))
  if (!leftover.length) return

  reporter.warn(
    `以下端口仍被占用：${leftover.join(', ')}`,
    process.platform === 'win32'
      ? `检查并结束残留进程：netstat -ano | findstr :${leftover[0]}，然后 taskkill /T /F /PID <PID>`
      : `检查并结束残留进程：lsof -i :${leftover[0]}`,
  )
}

const pnpmCommand = (arguments_) => {
  const invocation = resolvePnpmInvocation()
  return [invocation.command, ...invocation.arguments, ...arguments_].map(quote).join(' ')
}

/** Reads the site the localhost server will render, straight from its env file. */
const readDevSiteProfile = async () => {
  const envPath = join(appRoots.frontend, '.env.localhost')
  if (!existsSync(envPath)) return 'management-core（.env.localhost 缺失时的默认值）'

  const { readEnvValues } = await import('./lib/dev-env.mjs')
  return (await readEnvValues(envPath)).get('VITE_DEV_SITE_PROFILE') || 'management-core'
}

const main = async () => {
  const reporter = createReporter({ title: 'AppServerMonorepo 本地开发（免特权 localhost 模式）' })

  for (const result of await provisionEnvFiles({ write: true })) {
    if (result.status === 'pass') reporter.pass(result.message, result.detail)
    else if (result.status === 'warn') reporter.warn(result.message, result.hint)
    else reporter.fail(result.message, result.hint)
  }
  if (reporter.failures > 0) {
    process.exitCode = reporter.summary()
    return
  }

  const prismaResult = await ensurePrismaClient({ write: true })
  if (prismaResult.status === 'pass') reporter.pass(prismaResult.message)
  else reporter.fail(prismaResult.message, prismaResult.hint)

  const busyPorts = await findBusyPorts(Object.values(LOCAL_DEV_PORTS))
  if (busyPorts.length) {
    reporter.fail(
      `端口被占用：${busyPorts.join(', ')}`,
      process.platform === 'win32'
        ? `用 netstat -ano | findstr :${busyPorts[0]} 找到 PID 后结束该进程。`
        : `用 lsof -i :${busyPorts[0]} 找到进程后结束它。`,
    )
    process.exitCode = reporter.summary()
    return
  }
  reporter.pass(`端口空闲：${Object.values(LOCAL_DEV_PORTS).join(', ')}`)

  if (!existsSync(join(appRoots.frontend, 'swagger.json'))) {
    reporter.warn('apps/frontend/swagger.json 缺失', '运行 pnpm run openapi:gen:all 重新生成规范。')
  }

  reporter.log()
  reporter.log(`  前端（站点 ${await readDevSiteProfile()}）  ${frontendOrigin}`)
  reporter.log(`  后端 API / Swagger          ${apiOrigin}/docs`)
  reporter.log(`  文档站点                    ${docsOrigin}`)
  reporter.log('  种子账号与启动模式说明见 docs/development/16-local-development.md')
  reporter.log('  能力边界：Passkey、社交 OAuth 回跳、扫码登录、站点切换需要 pnpm run dev:domains。')
  reporter.log()

  const concurrentlyCli = resolveConcurrentlyCli()
  // Each command is handed to concurrently as one argument; concurrently owns
  // the shell parsing, so this spawn must not go through a shell itself.
  const exitCode = await spawnForeground(
    process.execPath,
    [
      concurrentlyCli,
      '--kill-others-on-fail',
      '--names',
      'backend,frontend,docs',
      '--prefix-colors',
      'blue,green,magenta',
      'node scripts/dev-local-backend.mjs',
      pnpmCommand(['--filter', '@quyan/frontend', 'run', 'dev:localhost']),
      pnpmCommand(['--filter', '@quyan/docs-site', 'run', 'dev']),
    ],
    { shell: false },
  )

  await reportLeftoverPorts(reporter)
  process.exitCode = exitCode
}

if (!existsSync(join(projectRoot, 'pnpm-workspace.yaml'))) {
  console.error('请在仓库根目录执行该命令。')
  process.exitCode = 1
} else {
  await main()
}
