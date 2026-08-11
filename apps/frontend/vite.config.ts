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
  const isProd = mode === 'production' || mode === 'prod'
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
  const localRootDomain =
    normalizeRootDomain(env.LOCAL_ROOT_DOMAIN, 'LOCAL_ROOT_DOMAIN') || 'qysyw.test'
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
    ...firstPartyHostPrefixes.map((prefix) => `${prefix}.${localRootDomain}`),
  ]
  const defaultHttpsKeyPath = `.certs/${localRootDomain}-key.pem`
  const defaultHttpsCertPath = `.certs/${localRootDomain}.pem`
  const httpsKeyPath = env.VITE_HTTPS_KEY_PATH?.trim() || defaultHttpsKeyPath
  const httpsCertPath = env.VITE_HTTPS_CERT_PATH?.trim() || defaultHttpsCertPath
  const https =
    existsSync(resolve(httpsKeyPath)) && existsSync(resolve(httpsCertPath))
      ? {
          key: readFileSync(resolve(httpsKeyPath)),
          cert: readFileSync(resolve(httpsCertPath)),
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
    },
    plugins: [
      autoRouteTypes({
        routesFile: 'src/router/routes.ts',
        outFile: 'src/types/route-types.gen.d.ts',
      }),
      buildInfoPlugin(),
      vue(),
      enableVueDevTools && vueDevTools(),
      visualizer(),
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
      proxy: {
        '^/api(?:/|$)': {
          target: 'http://localhost:10001',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api(?=\/|$)/, ''),
        },
        ...(isProd
          ? {
              '/prod-api': {
                target: `https://api.${resolvedRootDomain}`,
                changeOrigin: true,
                secure: true,
                configure: stripOriginHeader,
                rewrite: (path) => path.replace(/^\/prod-api/, ''),
              },
              '/prod-ai': {
                target: `https://ai.${resolvedRootDomain}`,
                changeOrigin: true,
                secure: true,
                configure: stripOriginHeader,
                rewrite: (path) => path.replace(/^\/prod-ai/, ''),
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
