import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { assertSafeRelativePath, readAllowedFile } from '../src/path-policy.js'
import { resolveWorkspaceRoot } from '../src/workspace.js'

let root = ''

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'quyan-mcp-'))
  await mkdir(path.join(root, '.git'))
  await writeFile(
    path.join(root, 'notes.md'),
    Array.from({ length: 6 }, (_, index) => 'line ' + (index + 1)).join('\n'),
  )
  await writeFile(path.join(root, '.env'), 'SECRET=value')
  await writeFile(path.join(root, 'image.bin'), Buffer.from([1, 0, 2]))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('path policy', () => {
  test('finds the workspace root from a package directory', async () => {
    const packageDirectory = path.join(root, 'packages', 'appserver-mcp')
    await mkdir(packageDirectory, { recursive: true })
    await writeFile(path.join(root, 'package.json'), '{}')
    await writeFile(path.join(root, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n')

    await expect(resolveWorkspaceRoot(packageDirectory)).resolves.toBe(root)
  })

  test('accepts a safe repository-relative path', () => {
    expect(assertSafeRelativePath('docs/../notes.md')).toBe('notes.md')
  })

  test('rejects sensitive and out-of-root paths', () => {
    expect(() => assertSafeRelativePath('../outside.txt')).toThrow()
    expect(() => assertSafeRelativePath('.env')).toThrow()
    expect(() => assertSafeRelativePath('.ENV')).toThrow()
    expect(() => assertSafeRelativePath('.git/config')).toThrow()
    expect(() => assertSafeRelativePath('.Git\\config')).toThrow()
    expect(() => assertSafeRelativePath('node_modules/a.js')).toThrow()
    expect(() => assertSafeRelativePath('node_modules\\a.js')).toThrow()
    expect(() => assertSafeRelativePath('private.key')).toThrow()
  })

  test('returns line-numbered and bounded text', async () => {
    const result = await readAllowedFile(root, { path: 'notes.md', startLine: 2, endLine: 4 })
    expect(result.startLine).toBe(2)
    expect(result.endLine).toBe(4)
    expect(result.content).toContain('    2 | line 2')
    expect(result.content).not.toContain('line 5')
  })

  test('rejects binary files and escaping symlinks', async () => {
    await expect(readAllowedFile(root, { path: 'image.bin' })).rejects.toThrow('二进制')
    await symlink(os.tmpdir(), path.join(root, 'outside-link'), 'junction')
    await expect(readAllowedFile(root, { path: 'outside-link/secret.txt' })).rejects.toThrow()
  })
})
