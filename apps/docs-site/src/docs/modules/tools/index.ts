import type { DocsRegistryBuilder, DocsPageModule } from '@/docs/types'

const modules = import.meta.glob<DocsPageModule>('./*.doc.ts', {
  eager: true,
  import: 'default',
})

const orderedModulePaths = [
  './support-assistant.doc.ts',
  './debug-tools.doc.ts',
  './quyan-cli.doc.ts',
  './script-manager.doc.ts',
] as const

export const registerToolsDocs = (registry: DocsRegistryBuilder) => {
  orderedModulePaths.forEach((modulePath) => {
    const page = modules[modulePath]
    if (!page) {
      throw new Error(`Missing docs module: ${modulePath}`)
    }
    registry.registerPage(page)
  })
}
