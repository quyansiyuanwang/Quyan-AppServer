import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { SUPPORTED_LOCALES } from '../../src/locales/locale'
import { createRequire } from 'node:module'

export type MessageTree = { [key: string]: string | MessageTree }
export type LocaleCatalog = {
  namespaces: Map<string, Record<string, MessageTree | string>>
  keys: Set<string>
  baseNamespaces: Set<string>
  errors: string[]
}

// Resolve the compiler from the installed vue-i18n package so validation uses
// the same version as the runtime, without introducing a second dependency.
const packageRequire = createRequire(import.meta.url)
const runtimeRequire = createRequire(packageRequire.resolve('vue-i18n'))
const { createParser } = runtimeRequire('@intlify/message-compiler') as {
  createParser: (options: { onError: (error: Error) => void }) => {
    parse: (text: string) => unknown
  }
}
export const messageSyntaxErrors = (text: string): string[] => {
  const errors: string[] = []
  createParser({ onError: (error) => errors.push(error.message) }).parse(text)
  return errors
}

const locales = SUPPORTED_LOCALES
const unwrap = (node: ts.Expression): ts.Expression => {
  while (
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isParenthesizedExpression(node)
  )
    node = node.expression
  return node
}

const flatten = (tree: MessageTree | string, prefix: string): Map<string, string> => {
  if (typeof tree === 'string') return new Map([[prefix, tree]])
  return new Map(
    Object.entries(tree).flatMap(([key, value]) => [
      ...flatten(value, prefix ? prefix + '.' + key : key),
    ]),
  )
}

export const interpolationKeys = (text: string): string[] =>
  [
    ...new Set(
      [...text.replace(/\{(['"])[\s\S]*?\1\}/g, '').matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)]
        .map((match) => match[1])
        .filter((key) => key !== 's'),
    ),
  ].sort()

/** Parse data, never execute a locale file during validation. */
export const readMessageTree = (file: string, errors: string[]): MessageTree => {
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  )
  const declarations = new Map<string, ts.Expression>()
  let exported: ts.Expression | undefined
  for (const statement of source.statements) {
    if (ts.isVariableStatement(statement))
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer)
          declarations.set(declaration.name.text, declaration.initializer)
      }
    if (ts.isExportAssignment(statement)) exported = statement.expression
  }
  const read = (expression: ts.Expression, key: string): MessageTree | string => {
    const value = unwrap(expression)
    if (ts.isIdentifier(value) && declarations.has(value.text))
      return read(declarations.get(value.text)!, key)
    if (ts.isStringLiteralLike(value)) return value.text
    if (!ts.isObjectLiteralExpression(value)) {
      errors.push(file + ': unsupported message value at ' + key)
      return ''
    }
    const result: MessageTree = {}
    for (const property of value.properties) {
      if (ts.isShorthandPropertyAssignment(property)) {
        const name = property.name.text
        if (Object.hasOwn(result, name))
          errors.push(file + ': duplicate message ' + key + '.' + name)
        result[name] = read(property.name, key ? key + '.' + name : name)
        continue
      }
      if (
        !ts.isPropertyAssignment(property) ||
        !(ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name))
      ) {
        errors.push(file + ': messages must use explicit properties at ' + key)
        continue
      }
      const name = property.name.text
      if (Object.hasOwn(result, name)) errors.push(file + ': duplicate message ' + key + '.' + name)
      result[name] = read(property.initializer, key ? key + '.' + name : name)
    }
    return result
  }
  if (!exported) {
    errors.push(file + ': missing default export')
    return {}
  }
  const tree = read(exported, '')
  if (typeof tree === 'string') {
    errors.push(file + ': expected a message object')
    return {}
  }
  return tree
}

export const readLocaleCatalog = (srcRoot: string): LocaleCatalog => {
  const localeRoot = path.join(srcRoot, 'locales')
  const bundlePaths = [
    'base',
    ...fs
      .readdirSync(path.join(localeRoot, 'sites'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => 'sites/' + entry.name),
  ]
  const namespaces: LocaleCatalog['namespaces'] = new Map()
  const errors: string[] = []
  const keys = new Set<string>()
  const baseNamespaces = new Set<string>()
  for (const bundle of bundlePaths) {
    const trees = Object.fromEntries(
      locales.map((locale) => [
        locale,
        readMessageTree(path.join(localeRoot, bundle, locale + '.ts'), errors),
      ]),
    )
    const reference = flatten(trees.en!, '')
    for (const locale of locales) {
      const messages = flatten(trees[locale]!, '')
      for (const [key, text] of messages) {
        if (!reference.has(key)) errors.push(bundle + '/' + locale + ': unknown key ' + key)
        if (!text.trim()) errors.push(bundle + '/' + locale + ': empty translation ' + key)
        for (const error of messageSyntaxErrors(text))
          errors.push(bundle + '/' + locale + ': invalid message ' + key + ': ' + error)
      }
      for (const [key, text] of reference) {
        if (!messages.has(key)) errors.push(bundle + '/' + locale + ': missing key ' + key)
        else if (interpolationKeys(text).join() !== interpolationKeys(messages.get(key)!).join())
          errors.push(bundle + '/' + locale + ': interpolation mismatch ' + key)
      }
    }
    for (const namespace of Object.keys(trees.en!)) {
      if (namespaces.has(namespace))
        errors.push(bundle + ': namespace has multiple owners: ' + namespace)
      namespaces.set(
        namespace,
        Object.fromEntries(locales.map((locale) => [locale, trees[locale]![namespace]!])),
      )
      if (bundle === 'base') baseNamespaces.add(namespace)
    }
    for (const key of reference.keys()) keys.add(key)
  }
  return { namespaces, keys, baseNamespaces, errors }
}

export const inspectTranslationReferences = (
  text: string,
  catalog: Pick<LocaleCatalog, 'keys' | 'namespaces'>,
): { namespaces: Set<string>; missing: string[] } => {
  const namespaces = new Set<string>()
  const missing: string[] = []
  // Includes metadata keys and templates as well as script calls. Dynamic keys
  // load their entire namespace; the typed translator checks their key union.
  for (const match of text.matchAll(/['"`]([A-Za-z][A-Za-z0-9_.:-]*)(?=['"`]|\$\{)/g)) {
    const value = match[1]
    if (catalog.keys.has(value)) namespaces.add(value.split('.')[0]!)
    else if (value.includes('.') && catalog.namespaces.has(value.split('.')[0]!))
      namespaces.add(value.split('.')[0]!)
  }
  for (const match of text.matchAll(
    /(?:(?:i18ns|\$i18ns|i18n\.global)\.(?:t|tf|tc|tref)|(?<![\w.])t)\(\s*(['"])([^'"\r\n]+)\1/g,
  )) {
    if (!catalog.keys.has(match[2])) missing.push(match[2])
  }
  return { namespaces, missing }
}

export const sourceFilesUnder = (directory: string): string[] =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (['client', 'locales', '.gen', 'node_modules'].includes(entry.name)) return []
    const file = path.join(directory, entry.name)
    return entry.isDirectory()
      ? sourceFilesUnder(file)
      : /\.(ts|vue|js)$/.test(file) && !file.endsWith('.d.ts') && !file.includes('.gen.')
        ? [file]
        : []
  })
