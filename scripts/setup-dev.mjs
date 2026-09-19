// Idempotent local onboarding: toolchain checks, .env provisioning, generated
// artifacts, and database migration/seed. `--check` is the read-only doctor mode.

import { createReporter } from './lib/dev-report.mjs'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { appRoots, projectRoot, runPnpm } from './lib/platform.mjs'
import {
  checkInfrastructure,
  checkToolchain,
  ensureFrontendClient,
  ensurePrismaClient,
  provisionEnvFiles,
} from './lib/dev-provision.mjs'

const arguments_ = new Set(process.argv.slice(2))
const checkOnly = arguments_.has('--check') || arguments_.has('--doctor')
const skipDb = arguments_.has('--skip-db')
const skipSeed = arguments_.has('--skip-seed')
const skipOpenapi = arguments_.has('--skip-openapi')
const forceEnv = arguments_.has('--force-env')
const forceOpenapi = arguments_.has('--force-openapi')

const printResults = (reporter, results) => {
  for (const result of results) {
    if (result.status === 'pass') reporter.pass(result.message, result.detail)
    else if (result.status === 'warn') reporter.warn(result.message, result.hint ?? result.detail)
    else reporter.fail(result.message, result.hint ?? result.detail)
  }
}

const printNextSteps = (reporter, { seeded }) => {
  reporter.log()
  reporter.log('下一步：')
  reporter.log('  pnpm run dev          # 免特权本地开发：http://localhost:5173（无需 hosts/mkcert/管理员）')
  reporter.log('  pnpm run dev:domains  # 多域名 HTTPS：https://www.qysyw.test:5173（需要 mkcert 与管理员权限）')
  reporter.log('  pnpm run doctor       # 只读诊断')
  reporter.log()
  reporter.log(`  管理面板  http://localhost:5173     API  http://localhost:10001/docs     文档  http://localhost:4173`)
  if (seeded)
    reporter.log('  种子账号  见上方 db:seed 输出（清单定义在 apps/backend/prisma/seed.ts）')
}

const runDatabaseSteps = (reporter) => {
  let seeded = false

  if (skipDb) {
    reporter.warn('已跳过数据库迁移（--skip-db）', '准备好 MySQL 后执行 pnpm run db:migrate')
    return seeded
  }

  reporter.log('\n执行数据库迁移（prisma migrate deploy）…')
  const migrateExitCode = runPnpm(['--filter', '@quyan/backend', 'run', 'db:migrate:deploy'])
  if (migrateExitCode !== 0) {
    reporter.fail(
      '数据库迁移失败',
      '若提示数据库不存在，请先按上面的 CREATE DATABASE 语句建库；不要改用 db push 绕过迁移。',
    )
    return seeded
  }
  reporter.pass('数据库迁移完成')

  if (skipSeed) {
    reporter.warn('已跳过种子数据（--skip-seed）', '需要登录账号时执行 pnpm run db:seed')
    return seeded
  }

  reporter.log('写入种子数据（prisma db seed，可重复执行）…')
  const seedExitCode = runPnpm(['--filter', '@quyan/backend', 'run', 'db:seed'])
  if (seedExitCode !== 0) {
    reporter.fail('种子数据写入失败', '单独执行 pnpm run db:seed 查看完整输出。')
    return seeded
  }
  reporter.pass('种子数据写入完成')
  return true
}

const main = async () => {
  if (!existsSync(join(projectRoot, 'pnpm-workspace.yaml'))) {
    console.error('请在仓库根目录执行该命令。')
    process.exitCode = 1
    return
  }

  const reporter = createReporter({
    title: checkOnly ? 'AppServerMonorepo 本地环境诊断（doctor）' : 'AppServerMonorepo 本地环境初始化',
  })

  reporter.log('\n[1/5] 工具链')
  printResults(reporter, await checkToolchain())

  reporter.log('\n[2/5] 环境配置文件')
  printResults(reporter, await provisionEnvFiles({ write: !checkOnly, force: forceEnv }))

  reporter.log('\n[3/5] 生成物')
  const prismaResult = await ensurePrismaClient({ write: !checkOnly })
  printResults(reporter, [prismaResult])

  const frontendClientResult = skipOpenapi
    ? { status: 'warn', message: '已跳过后端规范生成的前端客户端（--skip-openapi）' }
    : await ensureFrontendClient({ write: !checkOnly, force: forceOpenapi })
  printResults(reporter, [frontendClientResult])

  reporter.log('\n[4/5] 依赖服务（MySQL / Redis）')
  const infrastructure = await checkInfrastructure()
  printResults(reporter, infrastructure)
  const mysqlReady =
    !infrastructure.some((result) => result.status === 'fail') &&
    existsSync(join(appRoots.backend, '.env'))

  reporter.log('\n[5/5] 数据库')
  let seeded = false
  if (checkOnly) {
    reporter.warn('诊断模式不会写入数据库', '运行 pnpm run setup 执行迁移与种子数据。')
  } else if (!mysqlReady) {
    reporter.fail('跳过数据库迁移：MySQL 尚不可用', '启动 MySQL 后重新执行 pnpm run setup。')
  } else {
    seeded = runDatabaseSteps(reporter)
  }

  const exitCode = reporter.summary()
  if (!checkOnly && exitCode === 0) printNextSteps(reporter, { seeded })
  process.exitCode = exitCode
}

main().catch((error) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error)
  process.exitCode = 1
})
