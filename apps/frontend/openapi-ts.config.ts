import fs from 'fs'
import { defineConfig } from '@hey-api/openapi-ts'

const SWAGGER_PATHS = [
  './swagger.json',                        // synced by root scripts/ or committed in CI
]
const LOCAL_OPENAPI_URL = 'http://localhost:10001/docs/openapi.json'

const localPath = SWAGGER_PATHS.find((p) => fs.existsSync(p))

export default defineConfig({
  client: '@hey-api/client-axios',
  input: localPath ?? LOCAL_OPENAPI_URL,
  output: {
    path: './src/client',
    indexFile: false,
  },
  plugins: ['@hey-api/typescript'],
  naming: {
    operationId: 'camelCase',
  },
})
