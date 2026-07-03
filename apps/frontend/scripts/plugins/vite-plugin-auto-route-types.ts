import type { Plugin } from 'vite'
import path from 'node:path'
import { generateRouteTypes } from '../lib/route-types-generator.js'

type OptionsType = {
  /** 路由文件路径, 默认为 src/router/index.ts */
  routesFile?: string
  /** 输出文件路径, 默认为 auto-route.d.ts */
  outFile?: string
}

/**
 * 路由定义格式必须为
 * ```ts
 * export const routes = [
 *    ...
 * ] as const satisfies RouteRecordRaw[];
 * ```
 */
export function autoRouteTypes(options?: OptionsType): Plugin {
  let root = process.cwd()

  function run() {
    const routesFile = path.resolve(root, options?.routesFile || 'src/router/index.ts')
    const outFile = path.resolve(root, options?.outFile || 'auto-route.d.ts')
    generateRouteTypes(routesFile, outFile)
  }

  return {
    name: 'vite-plugin-auto-route-types',
    configResolved(config) {
      root = config.root
    },
    buildStart() {
      run()
    },
    configureServer(server) {
      const routesFile = path.resolve(root, options?.routesFile || 'src/router/index.ts')
      server.watcher.add(routesFile)
      server.watcher.on('change', (file) => {
        if (path.resolve(file) === routesFile) {
          run()
          server.ws.send({ type: 'full-reload' })
        }
      })
    },
  }
}
