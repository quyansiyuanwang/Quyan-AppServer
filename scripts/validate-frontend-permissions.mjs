#!/usr/bin/env node
/**
 * Root-level coordinator: validates that frontend and backend Permission
 * enums are synchronized.
 *
 * Parses TypeScript source text directly via regex -- no jiti/tsx
 * dependency needed at root level.
 *
 * Caveat: Assumes enum values are simple string literals (KEY = 'value').
 * If the enum ever uses computed expressions, this script will need
 * a TypeScript-aware parser (e.g. jiti).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

const frontendFile = path.resolve(rootDir, 'apps/frontend/src/constant/permission.ts')
const backendFile  = path.resolve(rootDir, 'apps/backend/src/constant/permission.ts')

function parseEnum(filePath) {
  const text = fs.readFileSync(filePath, 'utf-8')
  const entries = {}
  const regex = /^\s+(\w+)\s*=\s*['"]([^'"]+)['"],?\s*(?:\/\/.*)?$/gm
  let m
  while ((m = regex.exec(text)) !== null) {
    entries[m[1]] = m[2]
  }
  if (Object.keys(entries).length === 0) {
    console.error('Failed to parse Permission enum from: ' + filePath)
    process.exit(1)
  }
  return entries
}

const fe = parseEnum(frontendFile)
const be = parseEnum(backendFile)

const feKeys = Object.keys(fe)
const beKeys = Object.keys(be)

let failed = false

if (feKeys.length !== beKeys.length) {
  console.error(
    `❌ Permission count mismatch: Frontend(${feKeys.length}) vs Backend(${beKeys.length})`,
  )
  failed = true
}

const extraInFe = feKeys.filter(k => !beKeys.includes(k))
const missingInFe = beKeys.filter(k => !feKeys.includes(k))

if (extraInFe.length) {
  console.error('❌ Permissions in frontend but missing in backend: ' + extraInFe.join(', '))
  failed = true
}
if (missingInFe.length) {
  console.error('❌ Permissions in backend but missing in frontend: ' + missingInFe.join(', '))
  failed = true
}

for (const key of feKeys) {
  if (be[key] !== undefined && fe[key] !== be[key]) {
    console.error(`❌ Value mismatch for ${key}: Frontend(${fe[key]}) vs Backend(${be[key]})`)
    failed = true
  }
}

if (failed) {
  process.exit(1)
} else {
  console.log('✅ Permission enums are synchronized between frontend and backend')
}
