#!/usr/bin/env node
/**
 * Root-level coordinator: copies backend's swagger.json to frontend.
 *
 * Run after:  pnpm run openapi:gen  (backend generates swagger.json)
 * Run before: pnpm run openapi:gen:frontend (frontend generates client)
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

const src = path.resolve(rootDir, 'apps/backend/src/build/swagger.json')
const dest = path.resolve(rootDir, 'apps/frontend/swagger.json')

if (!fs.existsSync(src)) {
  console.error('Backend swagger.json not found at: ' + src)
  console.error('Run `pnpm run openapi:gen` first.')
  process.exit(1)
}

fs.copyFileSync(src, dest)
console.log('Synced swagger.json from backend to frontend')
