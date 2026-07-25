import type { DocsRegistryBuilder, DocsPageModule } from '@/docs/types'

const modules = import.meta.glob<DocsPageModule>('./*.doc.ts', { eager: true, import: 'default' })
const orderedModulePaths = [
  './developer-products-overview.doc.ts',
  './developer-product-kv.doc.ts',
  './developer-product-short-link.doc.ts',
  './developer-product-secret.doc.ts',
  './developer-product-status.doc.ts',
  './developer-product-verification.doc.ts',
  './developer-product-ip-geolocation.doc.ts',
  './developer-product-push.doc.ts',
] as const

export const registerDeveloperProductDocs = (registry: DocsRegistryBuilder) => {
  orderedModulePaths.forEach((modulePath) => registry.registerPage(modules[modulePath]!))
}
