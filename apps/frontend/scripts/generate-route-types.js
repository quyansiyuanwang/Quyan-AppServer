import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateRouteTypes } from './lib/route-types-generator.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

const routesFile = path.resolve(root, 'src/router/routes.ts')
const outFile = path.resolve(root, 'src/types/route-types.gen.d.ts')

const updated = generateRouteTypes(routesFile, outFile)
if (!updated) {
  console.log(`[generate-route-types] route-types.gen.d.ts 已是最新`)
}
