import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { generateDomainViewManifests } from '../../../scripts/generate-domain-view-manifests'
vi.mock('prettier', async (importOriginal) => {
  const original = await importOriginal<typeof import('prettier')>()
  return {
    ...original,
    format: async (...args: Parameters<typeof original.format>) => {
      await new Promise((resolve) => setTimeout(resolve, 0))
      return original.format(...args)
    },
  }
})

describe('generated domain view manifests', { timeout: 30_000 }, () => {
  it('keeps existing manifests readable during overlapping generation', async () => {
    const target = resolve(
      import.meta.dirname,
      '../../../src/router/.gen/domain-views/account.gen.ts',
    )
    const failures: unknown[] = []
    let reads = 0
    const reader = setInterval(() => {
      try {
        expect(readFileSync(target, 'utf8')).toContain('import.meta.glob<Component>')
        reads++
      } catch (error) {
        failures.push(error)
      }
    }, 1)
    try {
      await Promise.all([generateDomainViewManifests(), generateDomainViewManifests()])
    } finally {
      clearInterval(reader)
    }
    expect(reads).toBeGreaterThan(0)
    expect(failures).toEqual([])
  })
  it('keeps route views lazy instead of eagerly importing a whole domain', () => {
    const source = readFileSync(
      resolve(import.meta.dirname, '../../../src/router/.gen/domain-views/account.gen.ts'),
      'utf8',
    )

    expect(source).toContain('import.meta.glob<Component>')
    expect(source).toContain("eager: false, import: 'default'")
    expect(source).not.toContain('eager: true')
  })
})
