import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../src/service')

const toFunctionName = (operationId) => operationId.charAt(0).toLowerCase() + operationId.slice(1)

const collectServiceFiles = (dir) => {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) return collectServiceFiles(fullPath)
    return fullPath.endsWith('.ts') ? [fullPath] : []
  })
}

const normalizeImports = (content, usedFunctions) => {
  if (usedFunctions.size === 0) return content

  const sortedFunctions = [...usedFunctions].sort()
  const serviceImportBlock = `import {\n${sortedFunctions.map((name) => `  ${name},`).join('\n')}\n} from '@/client/api-services.gen'\n`

  const existingServiceImportPattern = /import\s*\{[\s\S]*?\}\s*from ['"]@\/client\/api-services\.gen['"]\n?/m
  if (existingServiceImportPattern.test(content)) {
    content = content.replace(existingServiceImportPattern, serviceImportBlock)
  } else {
    const imports = [...content.matchAll(/^import .*$/gm)]
    const lastImport = imports.at(-1)
    if (lastImport) {
      const insertAt = lastImport.index + lastImport[0].length
      content = `${content.slice(0, insertAt)}\n${serviceImportBlock}${content.slice(insertAt)}`
    } else {
      content = `${serviceImportBlock}\n${content}`
    }
  }

  return content
}

const cleanupUseRequestStore = (content) => {
  content = content.replace(/^\s*const request = useRequestStore\(\)\.getAxios\(\)\n/gm, '')

  const useRequestStoreNamedImportPattern = /import\s*\{\s*useRequestStore\s*\}\s*from ['"]@\/stores\/request['"]\n?/m
  const useRequestStoreMixedImportPattern = /import\s*\{([^}]*)\}\s*from ['"]@\/stores\/request['"]\n?/m

  if (!content.includes('useRequestStore')) {
    content = content.replace(useRequestStoreNamedImportPattern, '')
    content = content.replace(useRequestStoreMixedImportPattern, (full, members) => {
      const remaining = members
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .filter((item) => item !== 'useRequestStore')

      if (remaining.length === 0) return ''
      return `import { ${remaining.join(', ')} } from '@/stores/request'\n`
    })
  }

  return content
}

const migrateFile = (filePath) => {
  let content = fs.readFileSync(filePath, 'utf8')
  const usedFunctions = new Set()

  content = content.replace(
    /request\.(get|post|put|patch|delete)\(\s*'([A-Za-z0-9]+)'\s*(,\s*)?/g,
    (_, __method, operationId) => {
      const functionName = toFunctionName(operationId)
      usedFunctions.add(functionName)
      return `${functionName}(`
    },
  )

  if (usedFunctions.size === 0) return false

  content = normalizeImports(content, usedFunctions)
  content = cleanupUseRequestStore(content)
  content = content.replace(/\n{3,}/g, '\n\n')

  fs.writeFileSync(filePath, content, 'utf8')
  return true
}

const files = collectServiceFiles(ROOT)
const changedFiles = files.filter(migrateFile)
console.log(`Migrated ${changedFiles.length} service files.`)
