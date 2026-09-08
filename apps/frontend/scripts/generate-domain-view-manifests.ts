import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { fileURLToPath } from 'node:url'

type RouteViewReference = { routeName: string; feature: string; viewPath: string }

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const srcRoot = path.join(frontendRoot, 'src')
const routesFile = path.join(srcRoot, 'router', 'routes.ts')
const routeCatalogFile = path.join(srcRoot, 'router', 'route-catalog.ts')
const siteCatalogFile = path.join(srcRoot, 'config', 'site-catalog.ts')
const outputRoot = path.join(srcRoot, 'router', '.gen', 'domain-views')

const unwrap = (expression: ts.Expression): ts.Expression => {
  let current = expression
  while (
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isParenthesizedExpression(current)
  ) {
    current = current.expression
  }
  return current
}

const stringProperty = (object: ts.ObjectLiteralExpression, name: string): string | undefined => {
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) continue
    if (property.name.text !== name) continue
    const value = unwrap(property.initializer)
    if (ts.isStringLiteral(value)) return value.text
  }
  return undefined
}

const lazyFeatureViewCall = (
  object: ts.ObjectLiteralExpression,
): { feature: string; path: string } | undefined => {
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) continue
    if (property.name.text !== 'component') continue
    const value = unwrap(property.initializer)
    if (!ts.isCallExpression(value) || !ts.isIdentifier(value.expression)) continue
    if (value.expression.text !== 'lazyFeatureView' || value.arguments.length !== 2) continue
    const feature = unwrap(value.arguments[0])
    const viewPath = unwrap(value.arguments[1])
    if (ts.isStringLiteral(feature) && ts.isStringLiteral(viewPath)) {
      return { feature: feature.text, path: viewPath.text }
    }
  }
  return undefined
}

const collectRouteViews = (expression: ts.Expression, references: RouteViewReference[]) => {
  const value = unwrap(expression)
  if (!ts.isObjectLiteralExpression(value)) return

  const routeName = stringProperty(value, 'name')
  const view = lazyFeatureViewCall(value)
  if (routeName && view) {
    references.push({ routeName, feature: view.feature, viewPath: view.path })
  }

  for (const property of value.properties) {
    if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) continue
    if (property.name.text !== 'children') continue
    const children = unwrap(property.initializer)
    if (!ts.isArrayLiteralExpression(children)) continue
    for (const child of children.elements) collectRouteViews(child, references)
  }
}

const readRouteViews = (): RouteViewReference[] => {
  const source = fs.readFileSync(routesFile, 'utf8')
  const sourceFile = ts.createSourceFile(routesFile, source, ts.ScriptTarget.ESNext, true)
  const references: RouteViewReference[] = []

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue
    if (!statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      continue
    }
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== 'routes') continue
      const routes = declaration.initializer ? unwrap(declaration.initializer) : undefined
      if (!routes || !ts.isArrayLiteralExpression(routes)) continue
      for (const route of routes.elements) collectRouteViews(route, references)
    }
  }
  return references
}

const readRouteGroups = (): Map<string, string> => {
  const source = fs.readFileSync(routeCatalogFile, 'utf8')
  const groups = new Map<string, string>()
  const pattern = /\{\s*name:\s*['"]([^'"]+)['"][\s\S]*?group:\s*['"]([^'"]+)['"]/g
  for (const match of source.matchAll(pattern)) groups.set(match[1], match[2])
  return groups
}

const readRegisteredSiteIds = (): Set<string> => {
  const source = fs.readFileSync(siteCatalogFile, 'utf8')
  const sourceFile = ts.createSourceFile(siteCatalogFile, source, ts.ScriptTarget.ESNext, true)
  const ids = new Set<string>()
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== 'siteDefinitions')
        continue
      const initializer = declaration.initializer ? unwrap(declaration.initializer) : undefined
      if (!initializer || !ts.isArrayLiteralExpression(initializer)) continue
      const collect = (element: ts.Expression) => {
        const value = unwrap(element)
        if (ts.isObjectLiteralExpression(value)) {
          const id = stringProperty(value, 'id')
          if (id) ids.add(id)
        } else if (ts.isCallExpression(value)) {
          for (const argument of value.arguments) collect(argument)
        }
      }
      for (const element of initializer.elements) collect(element)
    }
  }
  const productSection = source.slice(
    source.indexOf('const productDefinitions'),
    source.indexOf('const productDefinitions') + 500,
  )
  const productList = /\[([\s\S]*?)\]\s*as const/.exec(productSection)
  for (const match of productList?.[1]?.matchAll(/['"]([^'"]+)['"]/g) ?? []) {
    ids.add(`product-${match[1]}`)
  }
  return ids
}

const inferGeneratedGroup = (routeName: string): string | undefined => {
  if (routeName.startsWith('product-management-') || routeName.startsWith('product-config-')) {
    return 'management-developer'
  }
  if (routeName.startsWith('product-')) return `product-${routeName.slice('product-'.length)}`
  return undefined
}

const resolveGroup = (routeName: string, groups: Map<string, string>): string | undefined =>
  groups.get(routeName) ?? inferGeneratedGroup(routeName)

const viewPathFor = (reference: RouteViewReference): string =>
  reference.feature === 'misc' ? reference.viewPath : `${reference.feature}/${reference.viewPath}`

const renderManifest = (siteId: string, viewPaths: readonly string[]): string => {
  const paths = viewPaths
    .slice()
    .sort()
    .map((viewPath) => `    '${`../../../views/${viewPath}`}',`)
    .join('\n')
  return [
    '/* Generated by scripts/generate-domain-view-manifests.ts. Do not edit. */',
    "import type { Component } from 'vue'",
    '',
    'export default import.meta.glob<Component>(',
    '  [',
    paths,
    '  ],',
    "  { eager: true, import: 'default' },",
    ')',
    '',
  ].join('\n')
}

export const generateDomainViewManifests = (): { sites: number; views: number } => {
  const groups = readRouteGroups()
  const references = readRouteViews()
  const knownSiteIds = readRegisteredSiteIds()
  const bySite = new Map<string, Set<string>>()
  const errors: string[] = []
  const routeAssignments = new Map<string, string>()

  for (const reference of references) {
    const siteId = resolveGroup(reference.routeName, groups)
    if (!siteId) {
      errors.push(`${reference.routeName}: route group is missing`)
      continue
    }
    if (!knownSiteIds.has(siteId)) {
      errors.push(`${reference.routeName}: unknown site id "${siteId}"`)
      continue
    }

    const viewPath = viewPathFor(reference)
    const assignment = `${siteId}:${viewPath}`
    const previous = routeAssignments.get(reference.routeName)
    if (previous && previous !== assignment) {
      errors.push(`${reference.routeName}: duplicate route mapping (${previous} and ${assignment})`)
      continue
    }
    routeAssignments.set(reference.routeName, assignment)
    const absolutePath = path.join(srcRoot, 'views', viewPath)
    if (!fs.existsSync(absolutePath)) {
      errors.push(
        `${reference.routeName} (${siteId}): missing ${path.relative(frontendRoot, absolutePath)}`,
      )
      continue
    }
    const paths = bySite.get(siteId) ?? new Set<string>()
    paths.add(viewPath)
    bySite.set(siteId, paths)
  }

  if (errors.length) {
    throw new Error(
      `Domain view manifest generation failed:\n${errors.map((error) => `- ${error}`).join('\n')}`,
    )
  }

  fs.mkdirSync(outputRoot, { recursive: true })
  for (const entry of fs.readdirSync(outputRoot, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.gen.ts'))
      fs.rmSync(path.join(outputRoot, entry.name))
  }

  let viewCount = 0
  for (const [siteId, paths] of [...bySite.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const target = path.join(outputRoot, `${siteId}.gen.ts`)
    const temporary = `${target}.${process.pid}.tmp`
    fs.writeFileSync(temporary, renderManifest(siteId, [...paths]), 'utf8')
    fs.rmSync(target, { force: true })
    fs.renameSync(temporary, target)
    viewCount += paths.size
  }

  return { sites: bySite.size, views: viewCount }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = generateDomainViewManifests()
  console.log(
    `[domain-views:generate] generated ${result.views} views across ${result.sites} sites`,
  )
}
