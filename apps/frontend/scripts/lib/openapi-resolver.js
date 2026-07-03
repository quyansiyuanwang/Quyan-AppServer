import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const OPENAPI_CANDIDATE_PATHS = [
  path.resolve(__dirname, '../../swagger.json'),
]

export function resolveOpenApiPath() {
  for (const candidate of OPENAPI_CANDIDATE_PATHS) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }

  throw new Error(
    `OpenAPI spec not found. Run the root sync first:\n` +
    `  pnpm run openapi:sync\n` +
    `Tried: ${OPENAPI_CANDIDATE_PATHS.join(', ')}`,
  )
}

export function loadOpenApiSpec() {
  const specPath = resolveOpenApiPath()
  console.log(`📂 Reading OpenAPI spec from: ${specPath}`)
  return JSON.parse(fs.readFileSync(specPath, 'utf-8'))
}