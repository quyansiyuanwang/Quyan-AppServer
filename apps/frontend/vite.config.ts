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
import { brotliCompressSync, constants as zlibConstants } from 'node:zlib'

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

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const isProd = mode === 'production' || mode === 'prod' || mode === 'staging'
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
  const rootDomain = normalizeRootDomain(env.ROOT_DOMAIN, 'ROOT_DOMAIN')
  if (isProd && !rootDomain)
    throw new Error('ROOT_DOMAIN must be defined for a production frontend build')
  const resolvedRootDomain = rootDomain || 'qysyw.cn'
  const publicSiteHostname =
    normalizeRootDomain(env.VITE_PUBLIC_SITE_HOST, 'VITE_PUBLIC_SITE_HOST') ||
    `www.${resolvedRootDomain}`
  const configuredBackendUrl = env.VITE_BACKEND_URL?.trim()
  const productionApiOrigin =
    env.API_ORIGIN?.trim() ||
    (/^https?:\/\//.test(configuredBackendUrl || '') ? configuredBackendUrl : undefined) ||
    'http://localhost:10001'
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
  const allowedHosts = [
    'localhost',
    publicSiteHostname,
    ...firstPartyHostPrefixes.map((prefix) => `${prefix}.${localRootDomain}`),
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

  const stripOriginHeader = (proxy: {
    on: (
      event: 'proxyReq',
      handler: (proxyReq: { removeHeader: (header: string) => void }) => void,
    ) => void
  }) => {
    proxy.on('proxyReq', (proxyReq) => {
      proxyReq.removeHeader('origin')
    })
  }

  const shouldSkipModulePreload = (dep: string): boolean =>
    dep.includes('lib-echarts-') ||
    dep.includes('lib-zrender-') ||
    dep.includes('lib-vue-echarts-') ||
    dep.includes('lib-markdown-') ||
    dep.includes('lib-html-sanitize-')

  const resolveNodeModuleChunk = (moduleId: string): string | undefined => {
    // Keep truly shared app/runtime dependencies in a stable base chunk.
    if (
      moduleId.includes('/vue/') ||
      moduleId.includes('/@vue/') ||
      moduleId.includes('/pinia/') ||
      moduleId.includes('/vue-router/') ||
      moduleId.includes('/vue-i18n/') ||
      moduleId.includes('/@intlify/') ||
      moduleId.includes('/@vueuse/')
    ) {
      return 'framework'
    }

    // Passkey is only used by related pages, keep it isolated for cache clarity.
    if (moduleId.includes('/@simplewebauthn/')) {
      return 'passkey'
    }

    // Split the data-viz stack so the largest async vendor chunk stays below
    // the warning threshold and browsers can cache stable layers independently.
    if (moduleId.includes('/zrender/')) {
      return 'lib-zrender'
    }

    if (moduleId.includes('/echarts/charts/')) {
      return 'lib-echarts-charts'
    }

    if (moduleId.includes('/echarts/components/')) {
      return 'lib-echarts-components'
    }

    if (moduleId.includes('/echarts/renderers/')) {
      return 'lib-echarts-renderers'
    }

    if (moduleId.includes('/echarts/')) {
      return 'lib-echarts-core'
    }

    if (moduleId.includes('/vue-echarts/')) {
      return 'lib-vue-echarts'
    }

    // Keep HTML sanitization separate so global notification code does not pull in
    // the full markdown/rendering stack.
    if (moduleId.includes('/dompurify/')) {
      return 'lib-html-sanitize'
    }

    // Markdown/rendering stack is heavy and should stay route-local/on-demand.
    if (moduleId.includes('/marked/') || moduleId.includes('/highlight.js/')) {
      return 'lib-markdown'
    }

    // Keep large single-purpose data libs in their own async chunks.
    if (moduleId.includes('/xlsx/')) {
      return 'lib-xlsx-async'
    }

    return undefined
  }

  const resolveManualChunk = (id: string): string | undefined => {
    const moduleId = id.replace(/\\/g, '/')

    // Keep Babel virtual helpers in the base chunk so feature chunks
    // cannot accidentally become entry dependencies.
    if (moduleId.includes('rollupPluginBabelHelpers')) {
      return 'framework'
    }

    if (!moduleId.includes('/node_modules/')) return undefined
    return resolveNodeModuleChunk(moduleId)
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
            [zlibConstants.BROTLI_PARAM_QUALITY]: zlibConstants.BROTLI_MAX_QUALITY,
          },
        })

        writeFileSync(`${fullPath}.br`, compressed)
      }
    }

    walk(rootDir)
  }

  return {
    define: {
      'import.meta.env.VITE_ROOT_DOMAIN': JSON.stringify(resolvedRootDomain),
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
      enableVueDevTools && vueDevTools(),
      // The report is generated by production builds only. Writing it while the
      // dev server is watching the project emits an unnecessary full-reload event.
      isProd && visualizer(),
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
      viteCompression({
        ext: '.gz',
        algorithm: 'gzip',
        threshold: 10240,
        deleteOriginFile: false,
      }),
      // SPA fallback: copy index.html → 404.html so static servers
      // (Nginx, Cloudflare Pages, etc.) serve the app for unknown routes.
      {
        name: 'copy-404',
        writeBundle() {
          const outDir = resolve(__dirname, 'dist')
          copyFileSync(resolve(outDir, 'index.html'), resolve(outDir, '404.html'))
        },
      },
      {
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
        // Keep the production prefixes usable during local development too. This
        // prevents an accidentally selected `.env.prod.local` from sending local
        // requests to a remote service; only the `prod` mode uses public hosts.
        '/prod-api': {
          target: isProd ? productionApiOrigin : 'http://localhost:10001',
          changeOrigin: true,
          secure: isProd,
          ...(isProd ? { configure: stripOriginHeader } : {}),
          rewrite: (path) => path.replace(/^\/prod-api/, ''),
        },
        '/prod-ai': {
          target: isProd ? `https://ai.${resolvedRootDomain}` : 'http://localhost:10001',
          changeOrigin: true,
          secure: isProd,
          ...(isProd ? { configure: stripOriginHeader } : {}),
          rewrite: (path) => path.replace(/^\/prod-ai/, isProd ? '' : '/relay/proxy'),
        },
      },
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    build: {
      minify: isProd ? 'terser' : false,
      target: 'es2022',
      modulePreload: {
        resolveDependencies: (_url, deps) => deps.filter((dep) => !shouldSkipModulePreload(dep)),
      },
      rollupOptions: {
        output: {
          entryFileNames: 'assets/[name]-[hash].js',
          chunkFileNames: 'assets/[name]-[hash].js',
          hoistTransitiveImports: false,
          manualChunks: resolveManualChunk,
        },
      },
      // The data-viz stack is intentionally isolated into async vendor chunks.
      // ECharts core still exceeds Vite's default 500 kB warning threshold,
      // but it no longer bloats the entry bundle.
      chunkSizeWarningLimit: 600,
    },
  }
})
