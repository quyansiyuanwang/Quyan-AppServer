// Provisioning checks shared by `pnpm run setup`, `pnpm run doctor` and `pnpm run dev`.

import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { appRoots, commandVersion, isTcpReachable, projectRoot, runPnpm } from './platform.mjs'
import { envPathsFor, envTargets, ensureEnvFiles, readEnvValues } from './dev-env.mjs'
import { parsePackageManager, satisfiesRange } from './version-check.mjs'

export const LOCAL_DEV_PORTS = { backend: 10001, frontend: 5173, docs: 4173 }

const mkcertInstallHint =
  process.platform === 'darwin'
    ? 'brew install mkcert nss'
    : process.platform === 'win32'
      ? 'winget install FiloSottile.mkcert'
      : '使用发行版包管理器安装 mkcert'

export async function readProjectManifest() {
  const manifestPath = join(projectRoot, 'package.json')
  return JSON.parse(await readFile(manifestPath, 'utf8'))
}

/** Node/pnpm/Bun/mkcert checks. Bun is required by the backend dev and build scripts. */
export async function checkToolchain() {
  const manifest = await readProjectManifest()
  const results = []

  const nodeVersion = process.versions.node
  if (satisfiesRange(nodeVersion, manifest.engines?.node)) {
    results.push({ status: 'pass', message: `Node ${nodeVersion} 满足 engines.node（${manifest.engines.node}）` })
  } else {
    results.push({
      status: 'fail',
      message: `Node ${nodeVersion} 不满足 engines.node（${manifest.engines.node}）`,
      hint: '切换 Node 版本（例如 nvm use 22）后重新执行。',
    })
  }

  const declaredManager = parsePackageManager(manifest.packageManager)
  const pnpmVersion = commandVersion('pnpm')
  if (!pnpmVersion) {
    results.push({ status: 'fail', message: '未找到 pnpm', hint: '执行 corepack enable 或安装 pnpm。' })
  } else if (declaredManager && pnpmVersion !== declaredManager.version) {
    results.push({
      status: 'warn',
      message: `pnpm ${pnpmVersion} 与 packageManager 声明的 ${declaredManager.version} 不一致`,
      hint: `执行 corepack prepare ${manifest.packageManager} --activate。`,
    })
  } else {
    results.push({ status: 'pass', message: `pnpm ${pnpmVersion} 与 packageManager 一致` })
  }

  const bunVersion = commandVersion('bun')
  if (bunVersion) {
    results.push({ status: 'pass', message: `Bun ${bunVersion} 可用` })
  } else {
    results.push({
      status: 'fail',
      message: '未找到 Bun（后端 dev/build 必需）',
      hint:
        process.platform === 'win32'
          ? 'powershell -c "irm bun.sh/install.ps1 | iex"'
          : 'curl -fsSL https://bun.sh/install | bash',
    })
  }

  const mkcertVersion = commandVersion('mkcert')
  if (mkcertVersion) {
    results.push({ status: 'pass', message: `mkcert ${mkcertVersion} 可用（dev 需要）` })
  } else {
    results.push({
      status: 'warn',
      message: '未找到 mkcert（默认的 pnpm run dev 多域名 HTTPS 需要）',
      hint: `${mkcertInstallHint}；免特权单站点模式 pnpm run dev:localhost 不需要它。`,
    })
  }

  if (existsSync(join(projectRoot, 'node_modules'))) {
    results.push({ status: 'pass', message: 'node_modules 已存在' })
  } else {
    results.push({
      status: 'fail',
      message: 'node_modules 缺失',
      hint: '先执行 pnpm install。',
    })
  }

  return results
}

function parseDatabaseUrl(value) {
  const match = /^mysql:\/\/([^:@/]+)(?::([^@]*))?@([^:/]+)(?::(\d+))?\/([^?]+)/.exec(
    String(value ?? '').trim(),
  )
  if (!match) return null
  return {
    user: decodeURIComponent(match[1]),
    password: match[2] ? decodeURIComponent(match[2]) : '',
    host: match[3],
    port: Number(match[4] || 3306),
    database: match[5],
  }
}

function createDatabaseStatements(values) {
  const databases = [
    parseDatabaseUrl(values.get('DATABASE_URL'))?.database,
    parseDatabaseUrl(values.get('APPSERVER_TEST_DATABASE_URL'))?.database,
  ].filter(Boolean)
  const unique = [...new Set(databases)]
  if (!unique.length) return []
  return unique.map(
    (database) => `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`,
  )
}

/**
 * Verifies that MySQL and Redis are reachable, and reports the exact statements
 * needed when the configured databases are missing. No container runtime is used.
 */
export async function checkInfrastructure() {
  const results = []
  const backendEnvPath = envPathsFor(envTargets[0]).envPath

  if (!existsSync(backendEnvPath)) {
    return [
      {
        status: 'fail',
        message: 'apps/backend/.env 不存在，无法检测 MySQL/Redis',
        hint: '先运行 pnpm run setup 生成配置。',
      },
    ]
  }

  const values = await readEnvValues(backendEnvPath)
  const database = parseDatabaseUrl(values.get('DATABASE_URL'))
  if (!database) {
    results.push({
      status: 'fail',
      message: 'DATABASE_URL 不是可解析的 MySQL 连接串',
      hint: '保持 mysql://user:password@host:3306/database 形式，不要附加 Prisma 时代的连接参数。',
    })
  } else {
    const reachable = await isTcpReachable(database.host, database.port)
    if (reachable) {
      results.push({
        status: 'pass',
        message: `MySQL 可连接（${database.host}:${database.port}）`,
        detail: `目标库：${database.database}`,
      })
    } else {
      const statements = createDatabaseStatements(values)
      results.push({
        status: 'fail',
        message: `MySQL 无法连接（${database.host}:${database.port}）`,
        hint: [
          '启动本机 MySQL 8 后重新执行 pnpm run setup。',
          statements.length
            ? `首次需要先建库：mysql -h ${database.host} -P ${database.port} -u ${database.user} -p -e "${statements.join(' ')}"`
            : '确认 DATABASE_URL 指向的实例已启动。',
        ].join(' '),
      })
    }
  }

  const redisHost = values.get('REDIS_HOST') || 'localhost'
  const redisPort = Number(values.get('REDIS_PORT') || 6379)
  const redisReachable = await isTcpReachable(redisHost, redisPort)
  results.push(
    redisReachable
      ? { status: 'pass', message: `Redis 可连接（${redisHost}:${redisPort}）` }
      : {
          status: 'warn',
          message: `Redis 无法连接（${redisHost}:${redisPort}）`,
          hint: '启动本机 Redis 7；缓存、限流与强制下线相关功能会降级。',
        },
  )

  return results
}

/**
 * The generated Prisma client lives next to the resolved `@prisma/client`
 * package (pnpm keeps it inside the virtual store), so the location is resolved
 * instead of assumed.
 */
const resolvePrismaClientMarkers = () => {
  const markers = [
    join(appRoots.backend, 'node_modules', '.prisma', 'client', 'index.d.ts'),
    join(projectRoot, 'node_modules', '.prisma', 'client', 'index.d.ts'),
  ]

  try {
    const require = createRequire(join(appRoots.backend, 'package.json'))
    const packageJsonPath = require.resolve('@prisma/client/package.json')
    markers.push(
      resolve(dirname(packageJsonPath), '..', '..', '.prisma', 'client', 'index.d.ts'),
    )
  } catch {
    // Fall back to the hoisted candidates above.
  }

  return markers
}

const frontendClientMarkers = [
  join(appRoots.frontend, 'src', 'client', 'types.gen.ts'),
  join(appRoots.frontend, 'src', 'client', 'api-types-map.gen.ts'),
  join(appRoots.frontend, 'src', 'client', 'api-endpoints.gen.ts'),
]

const newestMtime = (paths) => Math.max(...paths.map((path) => statSync(path).mtimeMs))

const isStale = (markers, sourcePath) => {
  const present = markers.filter((marker) => existsSync(marker))
  if (!present.length) return true
  return newestMtime(present) < statSync(sourcePath).mtimeMs
}

/** Keeps the generated Prisma client in sync with prisma/schema.prisma. */
export async function ensurePrismaClient({ write }) {
  const schemaPath = join(appRoots.backend, 'prisma', 'schema.prisma')
  if (!isStale(resolvePrismaClientMarkers(), schemaPath)) {
    return { status: 'pass', message: 'Prisma Client 已是最新' }
  }
  if (!write) {
    return {
      status: 'warn',
      message: 'Prisma Client 缺失或落后于 schema.prisma',
      hint: '运行 pnpm run setup（或 pnpm run db:generate）。',
    }
  }

  const exitCode = runPnpm(['--filter', '@quyan/backend', 'run', 'db:generate'])
  return exitCode === 0
    ? { status: 'pass', message: '已生成 Prisma Client' }
    : { status: 'fail', message: 'Prisma Client 生成失败', hint: '单独执行 pnpm run db:generate 查看完整输出。' }
}

/**
 * Keeps the ignored, generated frontend API client in sync with the committed
 * swagger.json. A fresh clone has no src/client, which otherwise breaks Vite.
 */
export async function ensureFrontendClient({ write, force = false }) {
  const swaggerPath = join(appRoots.frontend, 'swagger.json')
  if (!existsSync(swaggerPath)) {
    return {
      status: 'fail',
      message: 'apps/frontend/swagger.json 缺失，无法生成 API 客户端',
      hint: '运行 pnpm run openapi:gen:all 从后端重新生成规范。',
    }
  }

  if (!force && !isStale(frontendClientMarkers, swaggerPath)) {
    return { status: 'pass', message: '前端 API 客户端已是最新' }
  }
  if (!write) {
    return {
      status: 'warn',
      message: '前端 API 客户端缺失或落后于 swagger.json',
      hint: '运行 pnpm run setup（或 pnpm run openapi:gen:frontend）。',
    }
  }

  const exitCode = runPnpm(['--filter', '@quyan/frontend', 'run', 'openapi:generate'])
  return exitCode === 0
    ? { status: 'pass', message: '已生成前端 API 客户端（src/client）' }
    : {
        status: 'fail',
        message: '前端 API 客户端生成失败',
        hint: '单独执行 pnpm run openapi:gen:frontend 查看完整输出。',
      }
}

/** Creates missing env files and reports the outcome for the caller to print. */
export async function provisionEnvFiles({ write }) {
  return ensureEnvFiles({ write })
}
