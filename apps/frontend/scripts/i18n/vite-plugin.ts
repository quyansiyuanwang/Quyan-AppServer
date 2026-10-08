import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'
import { generateLocaleManifest } from './manifest'
import { readLocaleRouteReferences } from '../generate-domain-view-manifests'

/** Preserve normal Vue HMR unless translations or their dependency graph changed. */
export const i18nCoveragePlugin = (): Plugin => {
  const srcRoot = fileURLToPath(new URL('../../src', import.meta.url))
  let pending = Promise.resolve()
  const generate = () => {
    const task = pending.then(() => generateLocaleManifest(srcRoot, readLocaleRouteReferences()))
    pending = task.then(
      () => undefined,
      () => undefined,
    )
    return task
  }
  return {
    name: 'appserver-i18n-coverage',
    enforce: 'pre',
    async buildStart() {
      await generate()
    },
    async handleHotUpdate(context) {
      const relative = path.relative(srcRoot, context.file).replace(/\\/g, '/')
      if (
        relative.startsWith('../') ||
        relative.startsWith('client/') ||
        relative.includes('/.gen/') ||
        !/\.(ts|vue)$/.test(relative) ||
        relative.endsWith('.d.ts')
      )
        return
      const result = await generate()
      if (result.changed || relative.startsWith('locales/')) {
        context.server.ws.send({ type: 'full-reload' })
        return []
      }
    },
  }
}
