import { fileURLToPath, URL } from 'node:url'
import { copyFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

import viteCompression from 'vite-plugin-compression'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import ElementPlus from 'unplugin-element-plus/vite'
import { visualizer } from 'rollup-plugin-visualizer'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import obfuscatorPlugin from './scripts/plugins/vite-plugin-obfuscator-custom.js'
import { buildInfoPlugin } from './scripts/plugins/vite-plugin-build-info.js'
import { autoRouteTypes } from './scripts/plugins/vite-plugin-auto-route-types'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const isProd = mode === 'production' || mode === 'prod'
  const enableObfuscation = isProd && process.env.VITE_ENABLE_OBFUSCATION === 'true'

  const stripOriginHeader = (proxy: { on: (event: 'proxyReq', handler: (proxyReq: { removeHeader: (header: string) => void }) => void) => void }) => {
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
    if (
      moduleId.includes('/marked/') ||
      moduleId.includes('/highlight.js/')
    ) {
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

  return {
    plugins: [
      autoRouteTypes({
        routesFile: 'src/router/routes.ts',
        outFile: 'src/types/route-types.gen.d.ts'
      }),
      buildInfoPlugin(),
      vue(),
      vueDevTools(),
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
        importStyle: 'css',
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
    ].filter(Boolean),
    server: {
      host: true,
      allowedHosts: true,
      proxy: {
        '/api': {
          target: 'http://localhost:10001',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
        ...(isProd
          ? {
              '/prod-api': {
                target: 'https://api.qysyw.cn',
                changeOrigin: true,
                secure: true,
                configure: stripOriginHeader,
                rewrite: (path) => path.replace(/^\/prod-api/, ''),
              },
              '/prod-ai': {
                target: 'https://ai.qysyw.cn',
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
