import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../src/service')
const API_IMPORT_BASE = '@/client/services'
const REQUEST_IMPORT_PATH = "@/stores/request"

const toKebabCase = (value) => String(value)
  .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
  .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
  .toLowerCase()

const toControllerFilePath = (controllerName) => `${API_IMPORT_BASE}/${toKebabCase(controllerName)}.gen`

const toControllerFactoryName = (controllerName) => `create${controllerName}Api`

const toCamelCase = (value) => value.charAt(0).toLowerCase() + value.slice(1)

const toControllerVariableName = (controllerName) => {
  const head = controllerName.charAt(0).toLowerCase() + controllerName.slice(1)
  return head.endsWith('Controller') ? `${head.slice(0, -'Controller'.length)}Api` : `${head}Api`
}

const buildFactoryDeclaration = (controllerName) => {
  const variableName = toControllerVariableName(controllerName)
  const factoryName = toControllerFactoryName(controllerName)
  return `const ${variableName} = cacheObject(() => ${factoryName}(useRequestStore().getAxios()))`
}

const buildCachedFactoryDeclaration = (controllerName) => {
  const variableName = `get${controllerName}Api`
  const factoryName = toControllerFactoryName(controllerName)
  return `const ${variableName} = cache(() => ${factoryName}(useRequestStore().getAxios()))`
}

const collectServiceFiles = (dir) => {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) return collectServiceFiles(fullPath)
    return fullPath.endsWith('.ts') ? [fullPath] : []
  })
}

const normalizeNamedImport = (members) => {
  const uniqueMembers = [...new Set(members.map((item) => item.trim()).filter(Boolean))]
  return `import { ${uniqueMembers.join(', ')} } from '${REQUEST_IMPORT_PATH}'`
}

const ensureUseRequestStoreImport = (content) => {
  const requestImportRegex = /import\s*\{([^}]*)\}\s*from ['"]@\/stores\/request['"]/m
  const match = content.match(requestImportRegex)

  if (match) {
    const members = match[1]
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)

    if (!members.includes('useRequestStore')) {
      members.unshift('useRequestStore')
      content = content.replace(requestImportRegex, normalizeNamedImport(members))
    }

    return content
  }

  return `import { useRequestStore } from '${REQUEST_IMPORT_PATH}'\n${content}`
}

const upsertImport = (content, importLine) => {
  if (content.includes(importLine)) return content

  const imports = [...content.matchAll(/^import .*$/gm)]
  const lastImport = imports.at(-1)
  if (!lastImport) return `${importLine}\n\n${content}`

  const insertAt = lastImport.index + lastImport[0].length
  return `${content.slice(0, insertAt)}\n${importLine}${content.slice(insertAt)}`
}

const collectControllers = (content) => {
  const matches = [
    ...content.matchAll(/\bapi\.([a-z][A-Za-z0-9]+Controller)([A-Z][A-Za-z0-9]*)\b/g),
    ...content.matchAll(/\bgetApi\(\)\.([a-z][A-Za-z0-9]+Controller)([A-Z][A-Za-z0-9]*)\b/g),
  ]

  return [...new Set(matches.map((match) => `${match[1].charAt(0).toUpperCase()}${match[1].slice(1)}`))]
}

const replaceApiCalls = (content, controllerName, usesCacheFactory) => {
  const variableName = toControllerVariableName(controllerName)
  const aggregatePrefix = toCamelCase(controllerName)
  const replacementPrefix = usesCacheFactory ? `get${controllerName}Api().` : `${variableName}.`
  const methodPattern = new RegExp(`\\b(?:api|getApi\\(\\))\\.${aggregatePrefix}([A-Z][A-Za-z0-9]*)\\b`, 'g')
  return content.replace(methodPattern, (_, methodSuffix) => `${replacementPrefix}${methodSuffix.charAt(0).toLowerCase()}${methodSuffix.slice(1)}`)
}

const removeLegacyFactoryArtifacts = (content) => {
  content = content.replace(/^import\s*\{\s*createApiServices\s*\}\s*from ['"]@\/client\/api-services\.gen['"]\n?/m, '')
  content = content.replace(/^const api = cacheObject\(\(\) => createApiServices\(useRequestStore\(\)\.getAxios\(\)\)\)\n?/m, '')
  content = content.replace(/^const api = createApiServices\(useRequestStore\(\)\.getAxios\(\)\)\n?/m, '')
  content = content.replace(/^const getApi = cache\(\(\) => createApiServices\(useRequestStore\(\)\.getAxios\(\)\)\)\n?/m, '')
  return content
}

const migrateFile = (filePath) => {
  let content = fs.readFileSync(filePath, 'utf8')
  if (!content.includes("@/client/api-services.gen") && !content.includes('createApiServices(')) return false

  const usesCacheFactory = /const\s+getApi\s*=\s+cache\(/.test(content)
  const controllers = collectControllers(content)
  if (controllers.length === 0) return false

  content = removeLegacyFactoryArtifacts(content)
  content = ensureUseRequestStoreImport(content)

  for (const controllerName of controllers) {
    const importLine = `import { ${toControllerFactoryName(controllerName)} } from '${toControllerFilePath(controllerName)}'`
    content = upsertImport(content, importLine)
    content = replaceApiCalls(content, controllerName, usesCacheFactory)

    const declaration = usesCacheFactory
      ? buildCachedFactoryDeclaration(controllerName)
      : buildFactoryDeclaration(controllerName)

    if (!content.includes(declaration)) {
      const imports = [...content.matchAll(/^import .*$/gm)]
      const lastImport = imports.at(-1)
      const insertAt = lastImport ? lastImport.index + lastImport[0].length : 0
      content = `${content.slice(0, insertAt)}\n\n${declaration}${content.slice(insertAt)}`
    }
  }

  content = content.replace(/\n{3,}/g, '\n\n')
  fs.writeFileSync(filePath, content, 'utf8')
  return true
}

const files = collectServiceFiles(ROOT)
const changedFiles = files.filter(migrateFile)
console.log(`Migrated ${changedFiles.length} service files to controller-scoped API factories.`)