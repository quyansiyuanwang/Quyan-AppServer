import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { i18nCoveragePlugin } from '../../../scripts/i18n/vite-plugin'

const { generateMock } = vi.hoisted(() => ({ generateMock: vi.fn() }))
vi.mock('../../../scripts/i18n/manifest', () => ({ generateLocaleManifest: generateMock }))
vi.mock('../../../scripts/generate-domain-view-manifests', () => ({
  readLocaleRouteReferences: () => [],
}))
const srcRoot = fileURLToPath(new URL('../../../src', import.meta.url))
beforeEach(() => {
  generateMock.mockReset()
})

const update = async (file: string) => {
  const plugin = i18nCoveragePlugin()
  const send = vi.fn()
  const hook = plugin.handleHotUpdate
  if (typeof hook !== 'function') throw new Error('Missing hot update handler')
  const result = await hook.call(
    {} as any,
    { file: path.join(srcRoot, file), server: { ws: { send } } } as any,
  )
  return { result, send }
}

describe('i18n development reloads', () => {
  it('keeps normal Vue HMR when a page retains its translation dependencies', async () => {
    generateMock.mockResolvedValue({ changed: false })
    const { result, send } = await update('views/Fixture.vue')
    expect(result).toBeUndefined()
    expect(send).not.toHaveBeenCalled()
  })

  it('reloads after changed page dependencies or edited base messages', async () => {
    generateMock.mockResolvedValue({ changed: true })
    const page = await update('views/Fixture.vue')
    expect(page.send).toHaveBeenCalledWith({ type: 'full-reload' })
    expect(page.result).toEqual([])
    generateMock.mockResolvedValue({ changed: false })
    const base = await update('locales/base/en.ts')
    expect(base.send).toHaveBeenCalledWith({ type: 'full-reload' })
  })

  it('ignores generated files and reports translation failures to Vite', async () => {
    await update('router/.gen/i18n/manifest.gen.ts')
    expect(generateMock).not.toHaveBeenCalled()
    generateMock.mockRejectedValue(new Error('i18n coverage failed'))
    await expect(update('views/Fixture.vue')).rejects.toThrow('i18n coverage failed')
  })
})
