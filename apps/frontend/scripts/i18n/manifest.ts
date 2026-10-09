import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { SUPPORTED_LOCALES } from '../../src/locales/locale'
import { format } from 'prettier'
import { inspectTranslationReferences, readLocaleCatalog, sourceFilesUnder } from './catalog'

export interface LocaleRouteReference {
  routeName: string
  group: string
  files: string[]
}
const generatedHeader = '/* Generated from locale data and page dependencies. Do not edit. */\n'

export const analyzeLocaleCoverage = (srcRoot: string, routes: readonly LocaleRouteReference[]) => {
  const catalog = readLocaleCatalog(srcRoot)
  const files = sourceFilesUnder(srcRoot)
  const knownFiles = new Set(files.map((file) => path.resolve(file)))
  const components = new Map<string, string>()
  for (const file of files.filter(
    (file) => file.includes(path.sep + 'components' + path.sep) && file.endsWith('.vue'),
  )) {
    const name = path.basename(file, '.vue')
    components.set(name, file)
    components.set(name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase(), file)
  }
  const graph = new Map<string, { dependencies: string[]; namespaces: Set<string> }>()
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8')
    const inspected = inspectTranslationReferences(text, catalog)
    for (const key of inspected.missing)
      catalog.errors.push(path.relative(srcRoot, file) + ': undefined translation ' + key)
    const dependencies = new Set<string>()
    const resolveImport = (specifier: string) => {
      if (!specifier.startsWith('.') && !specifier.startsWith('@/')) return
      const absolute = specifier.startsWith('@/')
        ? path.join(srcRoot, specifier.slice(2))
        : path.resolve(path.dirname(file), specifier)
      const resolved = [
        absolute,
        absolute + '.ts',
        absolute + '.vue',
        absolute + '.js',
        path.join(absolute, 'index.ts'),
      ].find((candidate) => knownFiles.has(candidate))
      if (resolved && !resolved.endsWith(path.join('router', 'routes.ts')))
        dependencies.add(resolved)
    }
    const script = file.endsWith('.vue')
      ? [...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
          .map((match) => match[1])
          .join('\n')
      : text
    const ast = ts.createSourceFile(file, script, ts.ScriptTarget.Latest, true)
    const visit = (node: ts.Node) => {
      if (
        ts.isImportDeclaration(node) &&
        node.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword
      )
        return
      if (ts.isExportDeclaration(node) && node.isTypeOnly) return
      if (ts.isImportTypeNode(node)) return
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        resolveImport(node.moduleSpecifier.text)
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      )
        resolveImport(node.arguments[0].text)
      ts.forEachChild(node, visit)
    }
    visit(ast)
    if (file.endsWith('.vue'))
      for (const match of text.matchAll(/<([A-Za-z][\w-]*)\b/g)) {
        const component = components.get(match[1])
        if (component) dependencies.add(component)
      }
    graph.set(file, { dependencies: [...dependencies], namespaces: inspected.namespaces })
  }
  const collect = (roots: readonly string[]) => {
    const visited = new Set<string>()
    const namespaces = new Set<string>()
    const visit = (file: string) => {
      if (visited.has(file)) return
      visited.add(file)
      const entry = graph.get(file)
      if (!entry) {
        catalog.errors.push('Missing page dependency: ' + path.relative(srcRoot, file))
        return
      }
      for (const namespace of entry.namespaces)
        if (!catalog.baseNamespaces.has(namespace)) namespaces.add(namespace)
      for (const dependency of entry.dependencies) visit(dependency)
    }
    for (const file of roots) visit(file)
    return [...namespaces].sort()
  }
  // Every mounted root and global error/auth UI can translate outside a page.
  // These are actual entry files, rather than a second hand-written key map.
  const commonRoots = files.filter(
    (file) =>
      ['App.vue', 'IndexApp.vue', 'app-runtime.ts'].includes(path.relative(srcRoot, file)) ||
      path.relative(srcRoot, file).startsWith('app-roots' + path.sep),
  )
  const common = collect(commonRoots)
  const routeNamespaces: Record<string, string[]> = {}
  const siteNamespaces: Record<string, string[]> = {}
  for (const route of routes) {
    const namespaces = collect(route.files)
    routeNamespaces[route.routeName] = [
      ...new Set([...(routeNamespaces[route.routeName] ?? []), ...namespaces]),
    ].sort()
    siteNamespaces[route.group] = [
      ...new Set([...(siteNamespaces[route.group] ?? []), ...namespaces]),
    ].sort()
  }
  if (catalog.errors.length)
    throw new Error(
      'i18n coverage failed:\n' + catalog.errors.map((error) => '- ' + error).join('\n'),
    )
  return {
    catalog,
    common,
    routeNamespaces,
    siteNamespaces,
    pages: Object.keys(routeNamespaces).length,
    sources: files.length,
  }
}

const writeChanged = (file: string, text: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text) return false
  fs.writeFileSync(file, text)
  return true
}

export const generateLocaleManifest = async (
  srcRoot: string,
  routes: readonly LocaleRouteReference[],
  checkOnly = false,
) => {
  const audit = analyzeLocaleCoverage(srcRoot, routes)
  if (checkOnly)
    return { pages: audit.pages, sources: audit.sources, keys: audit.catalog.keys.size }
  let changed = false
  const outputRoot = path.join(srcRoot, 'router', '.gen', 'i18n')
  const namespaces = [...audit.catalog.namespaces.keys()]
    .filter((key) => !audit.catalog.baseNamespaces.has(key))
    .sort()
  for (const namespace of namespaces)
    for (const locale of SUPPORTED_LOCALES) {
      const messages = audit.catalog.namespaces.get(namespace)![locale]
      changed =
        writeChanged(
          path.join(outputRoot, 'messages', namespace, locale + '.gen.ts'),
          generatedHeader + 'export default ' + JSON.stringify({ [namespace]: messages }) + '\n',
        ) || changed
    }
  const loaders = namespaces
    .map(
      (namespace) =>
        JSON.stringify(namespace) +
        ': {' +
        ['en', 'zh-CN', 'emoji']
          .map(
            (locale) =>
              JSON.stringify(locale) +
              ": () => import('./messages/" +
              namespace +
              '/' +
              locale +
              ".gen').then(module => module.default)",
          )
          .join(',') +
        '}',
    )
    .join(',\n')
  const manifest =
    generatedHeader +
    "import type { LocaleBundle, Locale, LocaleNamespace, LocaleNamespaceLoaders } from '@/locales/schema'\n" +
    'export const namespaceLoaders = {' +
    loaders +
    '} satisfies LocaleNamespaceLoaders\n' +
    'export const commonLocaleNamespaces = ' +
    JSON.stringify(audit.common) +
    ' as const satisfies readonly LocaleNamespace[]\n' +
    'export const routeLocaleNamespaces = ' +
    JSON.stringify(audit.routeNamespaces) +
    ' satisfies Record<string, readonly LocaleNamespace[]>\n' +
    'export const siteLocaleNamespaces = ' +
    JSON.stringify(audit.siteNamespaces) +
    ' satisfies Record<string, readonly LocaleNamespace[]>\n' +
    'export const loadLocaleNamespace = (namespace: keyof typeof namespaceLoaders, locale: Locale): Promise<LocaleBundle> => namespaceLoaders[namespace][locale]()\n'
  changed =
    writeChanged(
      path.join(outputRoot, 'manifest.gen.ts'),
      await format(manifest, { parser: 'typescript', singleQuote: true, semi: false }),
    ) || changed
  return { pages: audit.pages, sources: audit.sources, keys: audit.catalog.keys.size, changed }
}
