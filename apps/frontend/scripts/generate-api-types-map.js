/**
 * This script parses types.gen.ts and OpenAPI spec to generate a type-safe API mapping
 * Run: node scripts/generate-api-types-map.js
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { loadOpenApiSpec } from './lib/openapi-resolver.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const TYPES_FILE_PATH = path.resolve(__dirname, '../src/client/types.gen.ts')
const OUTPUT_FILE_PATH = path.resolve(__dirname, '../src/client/api-types-map.gen.ts')
const SERVICES_OUTPUT_DIR_PATH = path.resolve(__dirname, '../src/client/services')
const LEGACY_SERVICE_OUTPUT_FILE_PATH = path.resolve(__dirname, '../src/client/api-services.gen.ts')
const normalizeOperationKey = (value) =>
  String(value || '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toLowerCase()

const toHeyApiOperationId = (value) =>
  String(value || '').replace(/([A-Z]+)([A-Z][a-z])/g, (match, capitals, lastPart) => {
    return capitals.charAt(0) + capitals.slice(1).toLowerCase() + lastPart
  })

async function fetchOpenApiSpec() {
  return loadOpenApiSpec()
}

/**
 * Extract method mapping from OpenAPI spec
 */
function extractMethodMapping(spec) {
  const mapping = {}
  for (const [_path, methods] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      if (operation.operationId) {
        // Convert operationId to match hey-api's camelCase format
        // e.g., "CreateIPBlacklist" -> "CreateIpBlacklist"
        const camelCaseId = toHeyApiOperationId(operation.operationId)
        const normalizedMethod = method.toUpperCase()
        mapping[normalizeOperationKey(operation.operationId)] = normalizedMethod
        mapping[normalizeOperationKey(camelCaseId)] = normalizedMethod
      }
    }
  }
  return mapping
}

function extractReplayProtectedOperationIds(spec) {
  const replayProtected = new Set()

  for (const methods of Object.values(spec.paths || {})) {
    for (const operation of Object.values(methods || {})) {
      if (!operation || typeof operation !== 'object' || !operation.operationId) continue
      if (operation['X-Replay-Protected'] === true) {
        replayProtected.add(normalizeOperationKey(operation.operationId))
        replayProtected.add(normalizeOperationKey(toHeyApiOperationId(operation.operationId)))
      }
    }
  }

  return replayProtected
}

/**
 * Extract API endpoint information from types.gen.ts
 */
function extractApiTypes(content, methodMapping, replayProtectedOperationIds) {
  const apiTypes = []
  const typePattern = /export type (\w+Data\d*) = \{([\s\S]*?)^\}/gm

  let match
  while ((match = typePattern.exec(content)) !== null) {
    const typeName = match[1]
    const typeBody = match[2]

    const urlMatch = typeBody.match(/url:\s*['"]([^'"]+)['"]/)
    if (!urlMatch) continue

    const url = urlMatch[1]
    const name = typeName.replace(/Data\d*$/, '')
    const method = methodMapping[normalizeOperationKey(name)] || 'GET'
    const isReplayProtected = replayProtectedOperationIds.has(normalizeOperationKey(name))

    const bodyMatch = typeBody.match(/body\??:\s*(\w+)/)
    const bodyType = bodyMatch && bodyMatch[1] !== 'never' ? `Types.${bodyMatch[1]}` : null

    const pathMatch = typeBody.match(/path\??:\s*\{/)
    const pathType = pathMatch ? `${typeName}['path']` : null

    const queryMatch = typeBody.match(/query\??:\s*\{/)
    const queryType = queryMatch ? `${typeName}['query']` : null

    const responsePattern = new RegExp(`export type (${name}Response\\d*)\\s*=`, 'm')
    const responseMatch = content.match(responsePattern)
    let responseType = responseMatch ? responseMatch[1] : null

    if (!responseType) {
      const responsesPattern = new RegExp(
        `export type ${name}Responses = \\{[\\s\\S]*?200:\\s*(\\w+)`,
        'm',
      )
      const responsesMatch = content.match(responsesPattern)
      responseType = responsesMatch ? responsesMatch[1] : null
    }

    const errorPattern = new RegExp(`export type ${name}Error = `, 'm')
    const errorType = errorPattern.test(content) ? `${name}Error` : null

    apiTypes.push({
      name,
      url,
      method,
      bodyType,
      pathType,
      queryType,
      responseType,
      errorType,
      isReplayProtected,
    })
  }

  return apiTypes
}

function toCamelCase(value) {
  if (!value) return value
  return value.charAt(0).toLowerCase() + value.slice(1)
}

function toControllerServiceName(endpointName) {
  const match = endpointName.match(/^(.+?Controller)(.+)$/)
  if (!match) return `${toCamelCase(endpointName)}Api`
  return `${toCamelCase(match[1])}Api`
}

function getControllerName(endpointName) {
  const match = endpointName.match(/^(.+?Controller)(.+)$/)
  return match ? match[1] : null
}

function toEndpointMethodName(endpointName) {
  const match = endpointName.match(/^.+?Controller(.+)$/)
  if (!match) return toCamelCase(endpointName)
  return toCamelCase(match[1])
}

function toEndpointFunctionName(endpointName) {
  return toCamelCase(endpointName)
}

function toKebabCase(value) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase()
}

function groupApisByController(apiTypes) {
  const groups = new Map()

  for (const api of apiTypes) {
    const controllerName = getControllerName(api.name)
    if (!controllerName) continue

    if (!groups.has(controllerName)) {
      groups.set(controllerName, [])
    }

    groups.get(controllerName).push(api)
  }

  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
}

function buildRequestArgType(api) {
  if (api.method === 'GET' || api.method === 'DELETE') {
    return `WithoutNever<{ path: typeof ${api.name}['path']; params: typeof ${api.name}['query'] }>`
  }

  return `WithoutNever<{ path: typeof ${api.name}['path']; body: typeof ${api.name}['body'] }>`
}

function buildRequestSignature(api) {
  const argType = buildRequestArgType(api)
  const isOptional = api.method === 'GET'
  const hasPath = api.pathType !== null
  const hasQuery = api.queryType !== null
  const hasBody = api.bodyType !== null

  if (!hasPath && !hasQuery && !hasBody) {
    return `reqOpt?: ${argType}`
  }

  if (isOptional) {
    return `reqOpt?: ${argType}`
  }

  return `reqOpt: ${argType}`
}

function generateApiServices(apiTypes) {
  const sharedLines = [
    '// Auto-generated by scripts/generate-api-types-map.js',
    '',
    "import type { RequestOptions } from '@/stores/request'",
    "import type { WithoutNever } from '@/types/common'",
    "import type { PromDeResp } from '@/types/responseData'",
    "import type { ApiEndpointDescriptor, ApiMethod } from '../api-types-map.gen'",
    '',
    'type EndpointWithMethod<METHOD extends ApiMethod> = ApiEndpointDescriptor<',
    '  METHOD,',
    '  any,',
    '  any,',
    '  any,',
    '  any,',
    '  any',
    '>',
    '',
    'export interface RequestClient {',
    "  post<ENDPOINT extends EndpointWithMethod<'POST'>>(",
    '    endpoint: ENDPOINT,',
    "    reqOpt: WithoutNever<{ path: ENDPOINT['path']; body: ENDPOINT['body'] }>,",
    '    options?: RequestOptions,',
    "  ): PromDeResp<ENDPOINT['response']>",
    "  get<ENDPOINT extends EndpointWithMethod<'GET'>>(",
    '    endpoint: ENDPOINT,',
    "    reqOpt?: WithoutNever<{ path: ENDPOINT['path']; params: ENDPOINT['query'] }>,",
    '    options?: RequestOptions,',
    "  ): PromDeResp<ENDPOINT['response']>",
    "  delete<ENDPOINT extends EndpointWithMethod<'DELETE'>>(",
    '    endpoint: ENDPOINT,',
    "    reqOpt: WithoutNever<{ path: ENDPOINT['path']; params: ENDPOINT['query'] }>,",
    '    options?: RequestOptions,',
    "  ): PromDeResp<ENDPOINT['response']>",
    "  put<ENDPOINT extends EndpointWithMethod<'PUT'>>(",
    '    endpoint: ENDPOINT,',
    "    reqOpt: WithoutNever<{ path: ENDPOINT['path']; body: ENDPOINT['body'] }>,",
    '    options?: RequestOptions,',
    "  ): PromDeResp<ENDPOINT['response']>",
    "  patch<ENDPOINT extends EndpointWithMethod<'PATCH'>>(",
    '    endpoint: ENDPOINT,',
    "    reqOpt: WithoutNever<{ path: ENDPOINT['path']; body: ENDPOINT['body'] }>,",
    '    options?: RequestOptions,',
    "  ): PromDeResp<ENDPOINT['response']>",
    '}',
  ]

  return groupApisByController(apiTypes).map(([controllerName, controllerApis]) => {
    const lines = [
      ...sharedLines,
      '',
      'import {',
      ...controllerApis.map((api) => `  ${api.name},`),
      "} from '../api-types-map.gen'",
      '',
    ]
    lines.push(`export const create${controllerName}Api = (requestClient: RequestClient) => ({`)
    lines.push(
      ...controllerApis.map((api) => {
        const functionName = toEndpointMethodName(api.name)
        const reqSignature = buildRequestSignature(api)
        const needsReqOpt = api.pathType !== null || api.queryType !== null || api.bodyType !== null
        const callReqOpt = needsReqOpt ? 'reqOpt' : 'reqOpt ?? {}'
        return [
          `  ${functionName}: (`,
          `    ${reqSignature},`,
          '    options?: RequestOptions,',
          `  ) => requestClient.${api.method.toLowerCase()}(${api.name}, ${callReqOpt}, options),`,
        ].join('\n')
      }),
    )
    lines.push('})', '')

    return {
      controllerName,
      fileName: `${toKebabCase(controllerName)}.gen.ts`,
      content: lines.join('\n'),
    }
  })
}

/**
 * Generate the type mapping file content
 */
function generateTypeMap(apiTypes) {
  const lines = [
    '// Auto-generated by scripts/generate-api-types-map.js',
    '',
    "import type * as Types from './types.gen'",
    "export type ApiMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'",
    '',
    'export interface ApiEndpointDescriptor<',
    '  TMethod extends ApiMethod = ApiMethod,',
    '  TBody = unknown,',
    '  TPath = unknown,',
    '  TQuery = unknown,',
    '  TResponse = unknown,',
    '  TError = unknown,',
    '> {',
    '  name: string',
    '  url: string',
    '  method: TMethod',
    '  replayProtected: boolean',
    '  body: TBody',
    '  path: TPath',
    '  query: TQuery',
    '  response: TResponse',
    '  error: TError',
    '}',
    '',
  ]

  for (const api of apiTypes) {
    const bodyType = api.bodyType || 'never'
    const pathType = api.pathType ? `NonNullable<Types.${api.pathType}>` : 'never'
    const queryType = api.queryType ? `NonNullable<Types.${api.queryType}>` : 'never'
    const responseType =
      api.responseType && api.responseType !== 'unknown' ? `Types.${api.responseType}` : 'unknown'
    const errorType =
      api.errorType && api.errorType !== 'unknown' ? `Types.${api.errorType}` : 'unknown'

    lines.push(
      `export type ${api.name}ApiType = ApiEndpointDescriptor<'${api.method}', ${bodyType}, ${pathType}, ${queryType}, ${responseType}, ${errorType}>`,
    )
  }

  lines.push('')
  for (const api of apiTypes) {
    const bodyType = api.bodyType || 'never'
    const pathType = api.pathType ? `NonNullable<Types.${api.pathType}>` : 'never'
    const queryType = api.queryType ? `NonNullable<Types.${api.queryType}>` : 'never'
    const responseType =
      api.responseType && api.responseType !== 'unknown' ? `Types.${api.responseType}` : 'unknown'
    const errorType =
      api.errorType && api.errorType !== 'unknown' ? `Types.${api.errorType}` : 'unknown'

    lines.push(`export const ${api.name} = {`)
    lines.push(`  name: '${api.name}' as const,`)
    lines.push(`  url: '${api.url}' as const,`)
    lines.push(`  method: '${api.method}' as const,`)
    lines.push(`  replayProtected: ${api.isReplayProtected},`)
    lines.push(`  body: undefined as unknown as ${bodyType},`)
    lines.push(`  path: undefined as unknown as ${pathType},`)
    lines.push(`  query: undefined as unknown as ${queryType},`)
    lines.push(`  response: undefined as unknown as ${responseType},`)
    lines.push(`  error: undefined as unknown as ${errorType},`)
    lines.push(`} as const satisfies ${api.name}ApiType`)
    lines.push('')
  }

  lines.push('export const ApiTypesMap = {')
  for (const api of apiTypes) {
    lines.push(`  ${api.name},`)
  }
  lines.push('} as const', '')

  return lines.join('\n')
}

async function main() {
  console.log('📖 Reading types.gen.ts...')
  if (!fs.existsSync(TYPES_FILE_PATH)) {
    console.error(`❌ Error: ${TYPES_FILE_PATH} not found`)
    process.exit(1)
  }

  console.log('🌐 Fetching OpenAPI spec...')
  const spec = await fetchOpenApiSpec()
  const methodMapping = extractMethodMapping(spec)
  const replayProtectedOperationIds = extractReplayProtectedOperationIds(spec)

  const content = fs.readFileSync(TYPES_FILE_PATH, 'utf-8')
  console.log('🔍 Extracting API type information...')
  const apiTypes = extractApiTypes(content, methodMapping, replayProtectedOperationIds)

  console.log(`✅ Found ${apiTypes.length} API endpoints:`)
  apiTypes.forEach((api) => {
    const parts = [api.method, api.url]
    if (api.bodyType) parts.push(`body: ${api.bodyType}`)
    if (api.responseType) parts.push(`→ ${api.responseType}`)
    console.log(`   - ${api.name}: ${parts.join(' ')}`)
  })

  console.log('📝 Generating type mapping file...')
  const output = generateTypeMap(apiTypes)
  fs.writeFileSync(OUTPUT_FILE_PATH, output, 'utf-8')
  console.log(`✨ Generated: ${OUTPUT_FILE_PATH}`)

  console.log('📝 Generating API services file...')
  const serviceOutputs = generateApiServices(apiTypes)
  fs.rmSync(SERVICES_OUTPUT_DIR_PATH, { recursive: true, force: true })
  fs.mkdirSync(SERVICES_OUTPUT_DIR_PATH, { recursive: true })
  for (const serviceOutput of serviceOutputs) {
    const outputPath = path.join(SERVICES_OUTPUT_DIR_PATH, serviceOutput.fileName)
    fs.writeFileSync(outputPath, serviceOutput.content, 'utf-8')
    console.log(`✨ Generated: ${outputPath}`)
  }

  if (fs.existsSync(LEGACY_SERVICE_OUTPUT_FILE_PATH)) {
    fs.rmSync(LEGACY_SERVICE_OUTPUT_FILE_PATH, { force: true })
    console.log(`🧹 Removed legacy aggregate service file: ${LEGACY_SERVICE_OUTPUT_FILE_PATH}`)
  }
}

main().catch(console.error)
