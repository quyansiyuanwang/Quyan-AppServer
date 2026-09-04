#!/usr/bin/env node
/**
 * Validates that frontend and backend both re-export the canonical Permission
 * enum from @quyan/shared, and that frontend PERMISSION_META covers every
 * enum member.
 *
 * Parses TypeScript source text directly via regex -- no jiti/tsx dependency.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

const sharedFile = path.resolve(rootDir, 'packages/shared/src/permission.ts')
const frontendFile = path.resolve(rootDir, 'apps/frontend/src/constant/permission.ts')
const backendFile = path.resolve(rootDir, 'apps/backend/src/constant/permission.ts')

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

function parseMetaKeys(filePath) {
  const text = fs.readFileSync(filePath, 'utf-8')
  const keys = new Set()
  const regex = /\[Permission\.(\w+)\]/g
  let m
  while ((m = regex.exec(text)) !== null) {
    keys.add(m[1])
  }
  return keys
}

function hasLocalEnum(filePath) {
  const text = fs.readFileSync(filePath, 'utf-8')
  return /export\s+enum\s+Permission\s*\{/.test(text)
}

function hasSharedReExport(filePath) {
  const text = fs.readFileSync(filePath, 'utf-8')
  return /@quyan\/shared/.test(text)
}

// Parse canonical enum from shared package
const canonical = parseEnum(sharedFile)
const canonicalKeys = Object.keys(canonical)

console.log(`Canonical Permission enum: ${canonicalKeys.length} members (packages/shared/src/permission.ts)`)

let failed = false

// Verify frontend re-exports from shared (no local enum)
if (hasLocalEnum(frontendFile)) {
  console.error('❌ Frontend permission.ts should not define a local Permission enum - it must re-export from @quyan/shared')
  failed = true
}
if (!hasSharedReExport(frontendFile)) {
  console.error('❌ Frontend permission.ts must re-export from @quyan/shared')
  failed = true
} else {
  console.log('✅ Frontend re-exports from @quyan/shared')
}

// Verify backend re-exports from shared (no local enum)
if (hasLocalEnum(backendFile)) {
  console.error('❌ Backend permission.ts should not define a local Permission enum - it must re-export from @quyan/shared')
  failed = true
}
if (!hasSharedReExport(backendFile)) {
  console.error('❌ Backend permission.ts must re-export from @quyan/shared')
  failed = true
} else {
  console.log('✅ Backend re-exports from @quyan/shared')
}

// Verify frontend PERMISSION_META covers all canonical enum members
const metaKeys = parseMetaKeys(frontendFile)
const missingMeta = canonicalKeys.filter(k => !metaKeys.has(k))
const extraMeta = [...metaKeys].filter(k => !canonicalKeys.includes(k))

if (missingMeta.length) {
  console.error('❌ PERMISSION_META missing entries for: ' + missingMeta.join(', '))
  failed = true
}
if (extraMeta.length) {
  console.error('❌ PERMISSION_META has extra entries not in canonical enum: ' + extraMeta.join(', '))
  failed = true
}
if (missingMeta.length === 0 && extraMeta.length === 0) {
  console.log(`✅ PERMISSION_META covers all ${canonicalKeys.length} canonical permissions`)
}

if (failed) {
  process.exit(1)
} else {
  console.log('✅ All permission validation checks passed')
}
