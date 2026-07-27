import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const sourceDirectory = path.resolve(process.cwd(), 'src')
const allowedFiles = new Set([
  path.join('utils', 'typedLocalStorage.ts'),
  path.join('utils', 'typedSessionStorage.ts'),
])
const directStorageAccess = /\b(?:window\.)?(?:localStorage|sessionStorage)\s*\./

const sourceFiles = (directory: string, relativePath = ''): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryRelativePath = path.join(relativePath, entry.name)
    const entryPath = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      return entry.name === 'client' ? [] : sourceFiles(entryPath, entryRelativePath)
    }

    return /\.(?:ts|vue)$/.test(entry.name) ? [entryRelativePath] : []
  })

describe('browser storage boundary', () => {
  it('allows direct browser storage access only in typed storage wrappers', () => {
    const violations = sourceFiles(sourceDirectory).filter((relativePath) => {
      if (allowedFiles.has(relativePath)) return false
      const content = readFileSync(path.join(sourceDirectory, relativePath), 'utf8')
      return directStorageAccess.test(content)
    })

    expect(violations).toEqual([])
  })
})
