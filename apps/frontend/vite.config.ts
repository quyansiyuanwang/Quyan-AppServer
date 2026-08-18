import { fileURLToPath, URL } from 'node:url'
import {
  copyFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { resolve } from 'node:path'
import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib'

import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

import viteCompression from 'vite-plugin-compression'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import ElementPlus from 'unplugin-element-plus/vite'
import { visualizer } from 'rollup-plugin-visualizer'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import obfuscatorPlugin from './scripts/plugins/vite-plugin-obfuscator-custom'
import { buildInfoPlugin } from './scripts/plugins/vite-plugin-build-info'
import { autoRouteTypes } from './scripts/plugins/vite-plugin-auto-route-types'

// Pre-compression is opt-in because hosts must explicitly serve `.br`/`.gz`
// assets. When enabled, level 6 avoids archival-grade build costs.
const BROTLI_BUILD_QUALITY = 6

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const isProd = mode === 'production' || mode === 'staging'
  const normalizeRootDomain = (value: string | undefined, name: string): string | undefined => {
    const normalized = value?.trim().toLowerCase().replace(/\.$/, '')
    if (!normalized) return undefined
    const labels = normalized.split('.')
    if (
      normalized.length > 253 ||
      labels.length < 2 ||
      labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
    ) {
      throw new Error(`${name} must be a hostname such as example.com`)
    }
    return normalized
  }
  const platformRootDomain = normalizeRootDomain(env.PLATFORM_ROOT_DOMAIN, 'PLATFORM_ROOT_DOMAIN')
  const siteRootDomain = normalizeRootDomain(env.SITE_ROOT_DOMAIN, 'SITE_ROOT_DOMAIN')
  if (isProd && (!platformRootDomain || !siteRootDomain)) {
    throw new Error(
      'PLATFORM_ROOT_DOMAIN and SITE_ROOT_DOMAIN must be defined for a release frontend build',
    )
  }
  const resolvedPlatformRootDomain = platformRootDomain || 'qysyw.cn'
  const resolvedSiteRootDomain = siteRootDomain || resolvedPlatformRootDomain
  const publicSiteHostname =
    normalizeRootDomain(env.VITE_PUBLIC_SITE_HOST, 'VITE_PUBLIC_SITE_HOST') ||
    `www.${resolvedSiteRootDomain}`
  const stagingSiteRootDomain = `staging.${resolvedPlatformRootDomain}`
  const configuredBackendUrl = env.VITE_BACKEND_URL?.trim()
  const expectedProductionApiOrigin = `https://api.${resolvedPlatformRootDomain}`
  const configuredAiProxyUrl = env.VITE_AI_PROXY_URL?.trim()
  const configuredRelayPublicBaseUrl = env.VITE_RELAY_PUBLIC_BASE_URL?.trim()
  const expectedRelayGatewayOrigin = `https://ai.${resolvedPlatformRootDomain}`
  if (isProd && configuredBackendUrl !== expectedProductionApiOrigin) {
    throw new Error(
      `VITE_BACKEND_URL must be ${expectedProductionApiOrigin} for ${mode} builds; ` +
        'browser backend requests must not use an SPA or authentication origin',
    )
  }
  if (
    isProd &&
    (configuredAiProxyUrl !== expectedRelayGatewayOrigin ||
      configuredRelayPublicBaseUrl !== expectedRelayGatewayOrigin)
  ) {
    throw new Error(
      `VITE_AI_PROXY_URL and VITE_RELAY_PUBLIC_BASE_URL must be ${expectedRelayGatewayOrigin} ` +
        `for ${mode} builds`,
    )
  }
  const localRootDomain =
    normalizeRootDomain(env.LOCAL_ROOT_DOMAIN, 'LOCAL_ROOT_DOMAIN') || 'qysyw.test'
  const preserveBrowserOrigin = (proxy: {
    on: (
      event: 'proxyReq',
      handler: (
        proxyReq: { setHeader: (name: string, value: string) => void },
        request: { headers?: { origin?: string } },
      ) => void,
    ) => void
  }) => {
    proxy.on('proxyReq', (proxyReq, request) => {
      const origin = request.headers?.origin
      if (origin) proxyReq.setHeader('origin', origin)
    })
  }
  const firstPartyHostPrefixes = [
    'www',
    'auth',
    'account',
    'chat',
    'terminal',
    'ai.console',
    'developer.console',
    'ram.console',
    'kv.console',
    'short-link.console',
    'secret.console',
    'status.console',
    'verification.console',
    'ip-geolocation.console',
    'push.console',
    'oj.console',
    'management',
    'ai.management',
    'developer.management',
    'terminal.management',
  ]
  const readBooleanEnv = (value: string | undefined, defaultValue: boolean): boolean => {
    if (value == null || value.trim() === '') return defaultValue
    return value === 'true'
  }

  const enableObfuscation = isProd && readBooleanEnv(env.VITE_ENABLE_OBFUSCATION, false)
  const enableVueDevTools = readBooleanEnv(env.VITE_ENABLE_VUE_DEVTOOLS, !isProd)
  const enableBuildAnalysis = isProd && readBooleanEnv(env.VITE_BUILD_ANALYZE, false)
  const enableStaticPrecompression = isProd && readBooleanEnv(env.VITE_PRECOMPRESS_ASSETS, false)
  const allowedHosts = [
    'localhost',
    publicSiteHostname,
    stagingSiteRootDomain,
    ...firstPartyHostPrefixes.map((prefix) => `${prefix}.${localRootDomain}`),
    ...firstPartyHostPrefixes.map((prefix) => `${prefix}.${stagingSiteRootDomain}`),
  ]
  const defaultHttpsKeyPath = `.certs/${localRootDomain}-key.pem`
  const defaultHttpsCertPath = `.certs/${localRootDomain}.pem`
  const httpsKeyPath = env.VITE_HTTPS_KEY_PATH?.trim() || defaultHttpsKeyPath
  const httpsCertPath = env.VITE_HTTPS_CERT_PATH?.trim() || defaultHttpsCertPath
  const resolvedHttpsKeyPath = resolve(__dirname, httpsKeyPath)
  const resolvedHttpsCertPath = resolve(__dirname, httpsCertPath)
  const https =
    existsSync(resolvedHttpsKeyPath) && existsSync(resolvedHttpsCertPath)
      ? {
          key: readFileSync(resolvedHttpsKeyPath),
          cert: readFileSync(resolvedHttpsCertPath),
        }
      : undefined

  const shouldSkipModulePreload = (dep: string): boolean =>
    dep.includes('charts-') ||
    dep.includes('markdown-') ||
    dep.includes('xlsx-') ||
    dep.includes('passkey-')

  const resolveNodeModuleChunk = (moduleId: string): string | undefined => {
    // Keep truly shared app/runtime dependencies in a stable base chunk.
    if (
      /\/node_modules\/(?:vue|pinia|vue-router|vue-i18n)(?:\/|$)/.test(moduleId) ||
      /\/node_modules\/@vue(?:\/|$)/.test(moduleId) ||
      /\/node_modules\/@intlify(?:\/|$)/.test(moduleId)
    ) {
      return 'framework'
    }

    // Passkey is only used by related pages, keep it isolated for cache clarity.
    if (moduleId.includes('/@simplewebauthn/')) {
      return 'passkey'
    }

    // The chart stack is optional, but its internal packages must arrive as
    // one request when a chart page is opened. Splitting it further turns one
    // navigation into an avoidable EdgeOne request waterfall.
    if (
      moduleId.includes('/echarts/') ||
      moduleId.includes('/zrender/') ||
      moduleId.includes('/vue-echarts/')
    ) {
      return 'charts'
    }

    // Markdown rendering and syntax highlighting stay on demand. Their
    // runtime modules statically collect their dependencies, avoiding a
    // separate network request for every highlighting language.
    if (moduleId.includes('/dompurify/') || moduleId.includes('/marked/')) {
      return 'markdown-renderer'
    }

    if (moduleId.includes('/highlight.js/')) return 'markdown-highlighter'

    // Keep large single-purpose data libs in their own async chunks.
    if (moduleId.includes('/xlsx/')) {
      return 'xlsx'
    }

    // crypto-js pulls Node/browser external shims in some builds. Forcing it
    // into the shared vendor chunk can make the entry chunk appear as a
    // reverse dependency (`index -> vendor -> index`), which is an unsafe ESM
    // initialization cycle. Let the graph-aware splitter keep it with the
    // feature that actually uses it.
    if (moduleId.includes('/crypto-js/')) {
      return undefined
    }

    // Keep non-core dependencies in a separate stable vendor layer. The
    // framework chunk must only contain the Vue runtime and its direct peers:
    // packages such as VueUse and Element Plus import Vue, but Vue itself must
    // never import those packages back. This one-way edge prevents the
    // framework/vendor ESM initialization cycles that previously produced
    // production-only "Cannot access ... before initialization" failures.
    return 'vendor'
  }

  const resolveApplicationChunk = (moduleId: string): string | undefined => {
    if (moduleId.endsWith('/src/utils/chart-runtime.ts')) return 'charts'
    if (moduleId.endsWith('/src/utils/markdown-renderer-runtime.ts')) return 'markdown-renderer'
    if (moduleId.endsWith('/src/utils/markdown-highlighter-runtime.ts'))
      return 'markdown-highlighter'

    const domainViewLoaderMatch = moduleId.match(/\/src\/router\/domain-views\/([a-z0-9_-]+)\.ts$/)
    if (domainViewLoaderMatch) return `domain-${domainViewLoaderMatch[1]}`

    // Site modules and application roots are selected from the hostname. They
    // must remain independent dynamic imports so one deployment does not load
    // every domain application's code on the first document.
    if (moduleId.includes('/src/plugins/sites/') || moduleId.includes('/src/app-roots/domains/')) {
      return undefined
    }

    // Views enter the graph through domain-specific loaders. Do not force
    // `src/views/<directory>` into a chunk because those directories cross
    // hostname boundaries (notably relay and products).
    return undefined
  }

  const resolveManualChunk = (id: string): string | undefined => {
    const moduleId = id.replace(/\\/g, '/')

    // Keep Babel virtual helpers in the base chunk so feature chunks
    // cannot accidentally become entry dependencies.
    if (moduleId.includes('rollupPluginBabelHelpers')) {
      return 'framework'
    }

    if (moduleId.includes('/node_modules/')) return resolveNodeModuleChunk(moduleId)
    return resolveApplicationChunk(moduleId)
  }

  const writeBrotliAssets = (rootDir: string, threshold: number) => {
    const compressibleExtensions = new Set([
      '.css',
      '.html',
      '.js',
      '.json',
      '.svg',
      '.txt',
      '.xml',
    ])

    const walk = (dirPath: string) => {
      for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
        const fullPath = resolve(dirPath, entry.name)

        if (entry.isDirectory()) {
          walk(fullPath)
          continue
        }

        const extensionIndex = entry.name.lastIndexOf('.')
        const extension = extensionIndex >= 0 ? entry.name.slice(extensionIndex) : ''
        if (
          !compressibleExtensions.has(extension) ||
          entry.name.endsWith('.br') ||
          entry.name.endsWith('.gz')
        ) {
          continue
        }

        const stats = statSync(fullPath)
        if (stats.size < threshold) {
          continue
        }

        const source = readFileSync(fullPath)
        const compressed = brotliCompressSync(source, {
          params: {
            [zlibConstants.BROTLI_PARAM_QUALITY]: BROTLI_BUILD_QUALITY,
          },
        })

        writeFileSync(`${fullPath}.br`, compressed)
      }
    }

    walk(rootDir)
  }

  /**
   * Site modules must remain dynamic imports. A static import here would make
   * every domain application part of the first document's module graph.
   */
  let bundleShapeReport: string | null = null
  const assertBundleShape = {
    name: 'assert-bundle-shape',
    generateBundle(_options: unknown, bundle: Record<string, unknown>) {
      const chunks = Object.values(bundle).filter(
        (
          entry,
        ): entry is {
          fileName: string
          isEntry: boolean
          imports: string[]
          dynamicImports: string[]
          modules: Record<string, unknown>
        } =>
          typeof entry === 'object' &&
          entry !== null &&
          'fileName' in entry &&
          'imports' in entry &&
          'dynamicImports' in entry &&
          'modules' in entry,
      )
      const entry = chunks.find((chunk) => chunk.isEntry)
      if (!entry) return

      const chunksByFileName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]))
      const indexChunk = chunks.find((chunk) => /^assets\/index-/.test(chunk.fileName))
      const vendorChunk = chunks.find((chunk) => /^assets\/vendor-/.test(chunk.fileName))
      const indexModules = new Set(Object.keys(indexChunk?.modules ?? {}))
      const vendorToIndexEdges = Object.keys(vendorChunk?.modules ?? {}).flatMap((moduleId) => {
        const info = this.getModuleInfo(moduleId)
        return (info?.importedIds ?? [])
          .filter((importedId) => indexModules.has(importedId))
          .map((importedId) => `${moduleId} -> ${importedId}`)
      })
      if (vendorToIndexEdges.length > 0) {
        throw new Error(
          `Vendor chunk depends on entry modules: ${vendorToIndexEdges.slice(0, 12).join(', ')}`,
        )
      }
      const visitedChunks = new Set<string>()
      const visitingChunks = new Set<string>()
      const visitChunkGraph = (fileName: string, stack: string[] = []) => {
        if (visitingChunks.has(fileName)) {
          const cycleStart = stack.indexOf(fileName)
          const cycle = [...stack.slice(cycleStart), fileName].join(' -> ')
          const cycleModules = cycle
            .split(' -> ')
            .map((name) => chunksByFileName.get(name))
            .flatMap((chunk) => Object.keys(chunk?.modules ?? {}).slice(0, 24))
          const isRouteBoundaryCycle = [...cycleModules].some((moduleId) =>
            /\/src\/(?:router\/domain-views|views)\//.test(moduleId.replace(/\\/g, '/')),
          )
          // Domain registry cycles are executed through Rolldown's strict
          // execution-order runtime below. Other cycles (especially the
          // framework/vendor/entry layers) remain a release blocker.
          if (!isRouteBoundaryCycle) {
            throw new Error(
              `Static framework chunk dependency cycle detected: ${cycle}\nModules: ${cycleModules.join(', ')}\n` +
                `Vendor-to-index edges: ${vendorToIndexEdges.slice(0, 12).join(', ')}`,
            )
          }
          visitingChunks.delete(fileName)
          visitedChunks.add(fileName)
          return
        }
        if (visitedChunks.has(fileName)) return
        visitingChunks.add(fileName)
        const chunk = chunksByFileName.get(fileName)
        chunk?.imports.forEach((dependency) => visitChunkGraph(dependency, [...stack, fileName]))
        visitingChunks.delete(fileName)
        visitedChunks.add(fileName)
      }
      chunks.forEach((chunk) => visitChunkGraph(chunk.fileName))

      const frameworkChunk = chunks.find((chunk) => /^assets\/framework-/.test(chunk.fileName))
      const unsafeFrameworkModule = Object.keys(frameworkChunk?.modules ?? {}).find((moduleId) =>
        /\/node_modules\/(?:\.pnpm\/)?(?:@vueuse(?:[+/])|vue-demi(?:[\/]))/.test(
          moduleId.replace(/\\/g, '/'),
        ),
      )
      if (unsafeFrameworkModule) {
        throw new Error(`Non-core Vue dependency was assigned to framework: ${unsafeFrameworkModule}`)
      }

      const initialChunkNames = new Set<string>()
      const visit = (fileName: string) => {
        if (initialChunkNames.has(fileName)) return
        initialChunkNames.add(fileName)
        chunksByFileName.get(fileName)?.imports.forEach(visit)
      }
      visit(entry.fileName)

      const deferredModulePattern =
        /\/src\/(?:plugins\/sites\/[^/]+\/site\.ts|app-roots\/domains)\//
      const eagerPlugin = [...initialChunkNames]
        .flatMap((fileName) => Object.keys(chunksByFileName.get(fileName)?.modules ?? {}))
        .map((moduleId) => moduleId.replace(/\\/g, '/'))
        .find((moduleId) => deferredModulePattern.test(moduleId))

      if (eagerPlugin) {
        throw new Error(`Site plugin was included in the entry graph: ${eagerPlugin}`)
      }

      const initialModules = [...initialChunkNames].flatMap((fileName) =>
        Object.keys(chunksByFileName.get(fileName)?.modules ?? {}),
      )
      const maxInitialChunks = 8
      if (initialChunkNames.size > maxInitialChunks) {
        throw new Error(
          `Entry graph contains ${initialChunkNames.size} static chunks; expected no more than ${maxInitialChunks}`,
        )
      }
      const eagerOptionalDependency = initialModules
        .map((moduleId) => moduleId.replace(/\\/g, '/'))
        .find((moduleId) =>
          /\/node_modules\/(?:echarts|zrender|vue-echarts|marked|highlight\.js|xlsx|@simplewebauthn)\//.test(
            moduleId,
          ),
        )
      if (eagerOptionalDependency) {
        const eagerChunkNames = [...initialChunkNames].filter((fileName) =>
          Object.keys(chunksByFileName.get(fileName)?.modules ?? {}).some(
            (moduleId) => moduleId.replace(/\\/g, '/') === eagerOptionalDependency,
          ),
        )
        throw new Error(
          `Optional dependency was included in the entry graph via ${eagerChunkNames.join(', ')}: ${eagerOptionalDependency}`,
        )
      }

      const emittedClientJavaScriptAssets = Object.values(bundle).filter(
        (entry) =>
          typeof entry === 'object' &&
          entry !== null &&
          'fileName' in entry &&
          typeof entry.fileName === 'string' &&
          /^assets\/.*\.js$/.test(entry.fileName),
      )
      // Route loaders retain small facades so each dynamic import can preserve
      // its component export. The budget leaves room for those facades while
      // still requiring a substantial reduction from the former 503 assets.
      const maxClientAssets = 180
      if (emittedClientJavaScriptAssets.length > maxClientAssets) {
        throw new Error(
          `Bundle emitted ${emittedClientJavaScriptAssets.length} JS assets before CSS output; expected no more than ${maxClientAssets}`,
        )
      }

      const domainChunks = chunks
        .filter((chunk) => /^assets\/domain-[^-]+-/.test(chunk.fileName))
        .map((chunk) => chunk.fileName)
        .sort()
      const requiredDomainChunks = ['identity', 'management-ai', 'product-kv']
      const missingDomainChunk = requiredDomainChunks.find(
        (domain) =>
          !domainChunks.some((fileName) => fileName.startsWith(`assets/domain-${domain}-`)),
      )
      if (missingDomainChunk) {
        throw new Error(`Expected a domain-${missingDomainChunk} chunk in the production output`)
      }
      const legacyFeatureChunk = chunks.find((chunk) => /^assets\/feature-/.test(chunk.fileName))
      if (legacyFeatureChunk) {
        throw new Error(`Legacy directory feature chunk emitted: ${legacyFeatureChunk.fileName}`)
      }
      const eagerDomainChunk = [...initialChunkNames].find((fileName) =>
        /\/assets\/domain-/.test(`/${fileName}`),
      )
      if (eagerDomainChunk) {
        throw new Error(
          `A domain bundle was included in the shared entry graph: ${eagerDomainChunk}`,
        )
      }

      const collectStaticDependencies = (fileName: string) => {
        const dependencyNames = new Set<string>()
        const visitDependency = (dependencyFileName: string) => {
          if (dependencyNames.has(dependencyFileName)) return
          dependencyNames.add(dependencyFileName)
          chunksByFileName.get(dependencyFileName)?.imports.forEach(visitDependency)
        }
        visitDependency(fileName)
        return [...dependencyNames].sort()
      }
      const routeDependencies = requiredDomainChunks.map((domain) => {
        const domainChunk = domainChunks.find((fileName) =>
          fileName.startsWith(`assets/domain-${domain}-`),
        )
        if (!domainChunk) return `${domain}=missing`
        const dependencies = collectStaticDependencies(domainChunk)
        const foreignDomainDependency = chunksByFileName
          .get(domainChunk)
          ?.imports.find(
            (fileName) =>
              fileName.startsWith('assets/domain-') &&
              !fileName.startsWith(`assets/domain-${domain}-`),
          )
        if (foreignDomainDependency) {
          throw new Error(
            `Domain bundle ${domainChunk} statically imports another domain bundle ${foreignDomainDependency}`,
          )
        }
        const stableDependencies = dependencies.filter((fileName) =>
          /\/assets\/(?:domain-|framework-|shell-|charts-|markdown-|xlsx-|passkey-)/.test(
            `/${fileName}`,
          ),
        )
        return `${domain}=${dependencies.length}:[${stableDependencies.join(',')}]`
      })
      bundleShapeReport = `initial=[${[...initialChunkNames].sort().join(',')}] routes=${routeDependencies.join(' ')}`
    },
    writeBundle() {
      const outputDir = resolve(__dirname, 'dist')
      const assetsDir = resolve(outputDir, 'assets')
      const clientAssets = readdirSync(assetsDir, { withFileTypes: true }).filter(
        (entry) => entry.isFile() && /\.(?:js|css)$/.test(entry.name),
      )
      const jsAssetCount = clientAssets.filter((entry) => entry.name.endsWith('.js')).length
      const cssAssetCount = clientAssets.filter((entry) => entry.name.endsWith('.css')).length
      if (clientAssets.length > 180) {
        throw new Error(
          `Bundle emitted ${clientAssets.length} JS/CSS assets; expected no more than 180`,
        )
      }
      const indexHtml = readFileSync(resolve(outputDir, 'index.html'), 'utf8')
      const initialAssetNames = [
        ...new Set(
          [...indexHtml.matchAll(/\/assets\/([^"']+\.(?:js|css))/g)].map((match) => match[1]),
        ),
      ]
      const initialSource = Buffer.concat(
        initialAssetNames.map((fileName) => readFileSync(resolve(assetsDir, fileName))),
      )
      const initialRawBytes = initialSource.length
      const initialGzipBytes = gzipSync(initialSource).length
      const initialBrotliBytes = brotliCompressSync(initialSource).length
      const maxInitialBrotliBytes = 700 * 1024
      if (initialBrotliBytes > maxInitialBrotliBytes) {
        throw new Error(
          `Entry assets compress to ${initialBrotliBytes} B with Brotli; expected no more than ${maxInitialBrotliBytes} B`,
        )
      }
      console.info(
        `[bundle-shape] assets=${clientAssets.length} js=${jsAssetCount} css=${cssAssetCount} ` +
          `initialRaw=${initialRawBytes} initialGzip=${initialGzipBytes} initialBrotli=${initialBrotliBytes} ` +
          `${bundleShapeReport ?? ''}`,
      )
    },
  }

  return {
    define: {
      'import.meta.env.VITE_PLATFORM_ROOT_DOMAIN': JSON.stringify(resolvedPlatformRootDomain),
      'import.meta.env.VITE_SITE_ROOT_DOMAIN': JSON.stringify(resolvedSiteRootDomain),
      'import.meta.env.VITE_LOCAL_ROOT_DOMAIN': JSON.stringify(localRootDomain),
      'import.meta.env.VITE_PUBLIC_SITE_HOST': JSON.stringify(publicSiteHostname),
    },
    plugins: [
      autoRouteTypes({
        routesFile: 'src/router/routes.ts',
        outFile: 'src/types/route-types.gen.d.ts',
      }),
      buildInfoPlugin(),
      vue(),
      assertBundleShape,
      enableVueDevTools && vueDevTools(),
      // The report is useful for an explicit bundle-analysis run, but writing
      // it for every release increases the critical build path substantially.
      enableBuildAnalysis && visualizer(),
      AutoImport({
        resolvers: [ElementPlusResolver({ importStyle: 'css' })],
      }),
      Components({
        resolvers: [
          ElementPlusResolver({
            importStyle: 'css',
          }),
        ],
      }),
      ElementPlus({
        useSource: false,
      }),
      // 生产环境启用代码混淆（closeBundle 钩子按插件顺序执行，确保先混淆再压缩）
      enableObfuscation &&
        obfuscatorPlugin({
          compact: true,
          controlFlowFlattening: false,
          deadCodeInjection: false,
          debugProtection: false,
          disableConsoleOutput: false,
          identifierNamesGenerator: 'mangled-shuffled',
          log: false,
          numbersToExpressions: false,
          renameGlobals: false,
          selfDefending: false,
          simplify: true,
          splitStrings: false,
          stringArray: false,
          transformObjectKeys: false,
          unicodeEscapeSequence: false,
        }),
      enableStaticPrecompression &&
        viteCompression({
          ext: '.gz',
          algorithm: 'gzip',
          threshold: 10240,
          deleteOriginFile: false,
        }),
      // SPA fallback: copy index.html → 404.html so static servers and
      // CDNs that do not rewrite unknown paths still boot the Vue router.
      {
        name: 'copy-404',
        writeBundle() {
          const outDir = resolve(__dirname, 'dist')
          const indexPath = resolve(outDir, 'index.html')
          const fallbackPath = resolve(outDir, '404.html')
          copyFileSync(indexPath, fallbackPath)
          if (
            !existsSync(fallbackPath) ||
            readFileSync(fallbackPath, 'utf8') !== readFileSync(indexPath, 'utf8')
          ) {
            throw new Error('SPA fallback 404.html was not emitted as a copy of index.html')
          }
        },
      },
      enableStaticPrecompression && {
        name: 'write-brotli-assets',
        writeBundle() {
          const outDir = resolve(__dirname, 'dist')
          writeBrotliAssets(outDir, 10240)
        },
      },
    ].filter(Boolean),
    server: {
      host: true,
      allowedHosts,
      https,
      watch: {
        // This declaration file is generated by the route-types plugin. It is
        // compile-time metadata and must not cause Vite to reload the browser
        // while the source route module is being edited.
        ignored: ['**/dist/**', '**/stats.html', '**/src/types/route-types.gen.d.ts'],
      },
      // Let the API proxy forward browser preflight requests to the backend.
      // Vite's built-in CORS middleware otherwise ends OPTIONS before the
      // backend can return its first-party-origin credentials policy.
      cors: false,
      proxy: {
        // Forward API requests from the frontend site to the backend server.
        ...(!isProd
          ? {
              '^/v1(?:/|$)': {
                target: 'http://localhost:10001',
                changeOrigin: false,
                configure: preserveBrowserOrigin,
              },
              // `/relay/*` also contains SPA routes such as `/relay/tokens` and
              // `/relay/settings`. Only the actual relay API belongs to the
              // backend; proxying the broad prefix makes Vite return the backend
              // JSON 404 instead of the console application.
              '^/relay/proxy(?:/|$)': {
                target: 'http://localhost:10001',
                changeOrigin: false,
                configure: preserveBrowserOrigin,
              },
              '^/auth-center(?:/|$)': {
                target: 'http://localhost:10001',
                changeOrigin: false,
                configure: preserveBrowserOrigin,
              },
              '^/docs(?:/|$)': {
                target: 'http://localhost:10001',
                changeOrigin: false,
                configure: preserveBrowserOrigin,
              },
            }
          : {}),
      },
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    build: {
      // Terser is considerably slower here and no Terser-specific transform
      // is configured. Rolldown/esbuild keeps release minification on the
      // fast native path.
      minify: isProd ? 'esbuild' : false,
      target: 'es2022',
      // One cacheable stylesheet avoids a second request waterfall where each
      // route/component contributes a sub-kilobyte CSS asset. The JS feature
      // boundaries remain lazy, so optional application logic is not moved
      // into the entry module graph.
      cssCodeSplit: false,
      modulePreload: {
        resolveDependencies: (_url, deps) => deps.filter((dep) => !shouldSkipModulePreload(dep)),
      },
      rollupOptions: {
        preserveEntrySignatures: 'allow-extension',
        experimental: {
          strictExecutionOrder: true,
        },
        output: {
          entryFileNames: 'assets/[name]-[hash].js',
          chunkFileNames: 'assets/[name]-[hash].js',
          hoistTransitiveImports: false,
          advancedChunks: {
            // Only explicitly selected boundaries are captured. Shared
            // application dependencies remain graph-owned so they cannot
            // create a reverse edge from a domain chunk into the entry.
            includeDependenciesRecursively: false,
            groups: [{ name: resolveManualChunk }],
          },
        },
      },
      // The data-viz stack is intentionally isolated into async vendor chunks.
      // ECharts core still exceeds Vite's default 500 kB warning threshold,
      // but it no longer bloats the entry bundle.
      chunkSizeWarningLimit: 600,
    },
  }
})
