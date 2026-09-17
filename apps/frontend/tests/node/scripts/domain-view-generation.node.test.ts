import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('generated domain view manifests', () => {
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
