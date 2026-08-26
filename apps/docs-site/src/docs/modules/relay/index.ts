import type { DocsRegistryBuilder, DocsPageModule } from '@/docs/types'

const modules = import.meta.glob<DocsPageModule>('./*.doc.ts', {
  eager: true,
  import: 'default',
})

const orderedModulePaths = [
  './ai-relay-quickstart.doc.ts',
  './relay-token-management.doc.ts',
  './channel-provider-revenue.doc.ts',
  './relay-settings.doc.ts',
  './relay-channel-probes.doc.ts',
  './content-safety.doc.ts',
  './upstream-status.doc.ts',
  './remote-terminal.doc.ts',
  './remote-terminal-management.doc.ts',
] as const

export const registerRelayDocs = (registry: DocsRegistryBuilder) => {
  orderedModulePaths.forEach((modulePath) => {
    const page = modules[modulePath]
    if (!page) {
      throw new Error(`Missing docs module: ${modulePath}`)
    }
    registry.registerPage(page)
  })
}
