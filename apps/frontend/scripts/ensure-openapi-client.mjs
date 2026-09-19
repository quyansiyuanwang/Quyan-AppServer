#!/usr/bin/env node
/**
 * Regenerates the generated, git-ignored typed API client when it is missing or
 * older than the committed swagger.json.
 *
 * A fresh clone has no `src/client`, yet every service imports it, so
 * `pnpm run dev` would fail to resolve modules. Generation reads the committed
 * swagger.json and therefore does not need a running backend.
 */

import { existsSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const swaggerPath = path.join(appRoot, 'swagger.json')
const clientDirectory = path.join(appRoot, 'src', 'client')
const clientMarkers = ['types.gen.ts', 'api-types-map.gen.ts', 'api-endpoints.gen.ts'].map((name) =>
  path.join(clientDirectory, name),
)

const force = process.argv.slice(2).includes('--force')

const isStale = () => {
  if (force) return true
  if (!existsSync(swaggerPath)) return true
  if (clientMarkers.some((marker) => !existsSync(marker))) return true
  const newestMarker = Math.max(
    ...clientMarkers.filter((marker) => existsSync(marker)).map((marker) => statSync(marker).mtimeMs),
  )
  return newestMarker < statSync(swaggerPath).mtimeMs
}

if (!isStale()) {
  console.log('✓ 前端 API 客户端（src/client）已是最新')
  process.exit(0)
}

if (!existsSync(swaggerPath)) {
  console.error('apps/frontend/swagger.json 缺失：请先运行 pnpm run openapi:gen。')
  process.exit(1)
}

console.log('生成前端 API 客户端（src/client）…')
// `shell: true` receives one command line: Node deprecates an args array there.
const commandLine =
  process.platform === 'win32' ? 'pnpm.cmd run openapi:generate' : 'pnpm run openapi:generate'
const result = spawnSync(commandLine, {
  cwd: appRoot,
  stdio: 'inherit',
  shell: true,
})

if (result.status !== 0)
  console.error('前端 API 客户端生成失败：请单独运行 pnpm run openapi:generate 查看完整输出。')

process.exit(result.status ?? 1)
