import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { afterEach, describe, expect, it } from 'vitest'
import {
  interpolationKeys,
  messageSyntaxErrors,
  inspectTranslationReferences,
  readLocaleCatalog,
} from '../../../scripts/i18n/catalog'
import { analyzeLocaleCoverage } from '../../../scripts/i18n/manifest'

const fixtureRoots: string[] = []
const fixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'appserver-i18n-fixture-'))
  fixtureRoots.push(root)
  const write = (name: string, text: string) => {
    const file = path.join(root, name)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, text)
  }
  for (const locale of ['en', 'zh-CN', 'emoji']) {
    write(
      'locales/base/' + locale + '.ts',
      "const messages = { save: 'Save' }; export default messages",
    )
    write(
      'locales/sites/example/' + locale + '.ts',
      "const messages = { relay: { title: 'Relay', count: '{count} items' } }; export default messages",
    )
  }
  return { root, write }
}
afterEach(() => {
  for (const root of fixtureRoots.splice(0)) {
    if (
      path.dirname(root) !== os.tmpdir() ||
      !path.basename(root).startsWith('appserver-i18n-fixture-')
    )
      throw new Error('Unexpected fixture path')
    fs.rmSync(root, { recursive: true, force: true })
  }
})

describe('i18n coverage enforcement', () => {
  it('rejects missing keys, extra keys, empty text and missing business parameters', () => {
    const { root, write } = fixture()
    write(
      'locales/sites/example/zh-CN.ts',
      "const messages = { relay: { count: 'Records', extra: '' } }; export default messages",
    )
    const catalog = readLocaleCatalog(root)
    expect(catalog.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('missing key relay.title'),
        expect.stringContaining('unknown key relay.extra'),
        expect.stringContaining('empty translation relay.extra'),
        expect.stringContaining('interpolation mismatch relay.count'),
      ]),
    )
    expect(() => analyzeLocaleCoverage(root, [])).toThrow('i18n coverage failed')
  })

  it('rejects duplicate namespaces and duplicate leaves within a bundle', () => {
    const { root, write } = fixture()
    for (const locale of ['en', 'zh-CN', 'emoji'])
      write(
        'locales/sites/duplicate/' + locale + '.ts',
        "const messages = { relay: { title: 'One', title: 'Two' } }; export default messages",
      )
    const errors = readLocaleCatalog(root).errors
    expect(errors.some((error) => error.includes('duplicate message relay.title'))).toBe(true)
    expect(errors.some((error) => error.includes('multiple owners: relay'))).toBe(true)
  })

  it('checks script/template calls and metadata while loading entire dynamic namespaces', () => {
    const { root } = fixture()
    const catalog = readLocaleCatalog(root)
    const result = inspectTranslationReferences(
      "i18ns.t('relay.missing'); t('relay.title'); labelKey: 'relay.count'; i18ns.t(`relay.${state}`)",
      catalog,
    )
    expect(result.missing).toEqual(['relay.missing'])
    expect([...result.namespaces]).toEqual(['relay'])
  })

  it('derives page requirements through imports and automatically registered components', () => {
    const { root, write } = fixture()
    write('views/Page.vue', '<template><FixtureChild /></template>')
    write(
      'components/FixtureChild.vue',
      '<script setup lang="ts">import { label } from "@/helpers/label"</script><template>{{ label }}</template>',
    )
    write('helpers/label.ts', "export const label = () => i18ns.t('relay.title')")
    const audit = analyzeLocaleCoverage(root, [
      { routeName: 'fixturePage', group: 'example', files: [path.join(root, 'views/Page.vue')] },
    ])
    expect(audit.routeNamespaces.fixturePage).toEqual(['relay'])
  })

  it('combines same-name compatibility routes without letting redirects erase page requirements', () => {
    const { root, write } = fixture()
    for (const locale of ['en', 'zh-CN', 'emoji'])
      write(
        'locales/sites/other/' + locale + '.ts',
        "const messages = { other: { title: 'Other' } }; export default messages",
      )
    write('views/First.vue', "<template>{{ i18ns.t('relay.title') }}</template>")
    write('views/Second.vue', "<template>{{ i18ns.t('other.title') }}</template>")
    const audit = analyzeLocaleCoverage(root, [
      { routeName: 'fixturePage', group: 'example', files: [path.join(root, 'views/First.vue')] },
      { routeName: 'fixturePage', group: 'example', files: [path.join(root, 'views/Second.vue')] },
      { routeName: 'fixturePage', group: 'example', files: [] },
    ])
    expect(audit.routeNamespaces.fixturePage).toEqual(['other', 'relay'])
    expect(audit.pages).toBe(1)
  })

  it('rejects invalid references even in a page that is not registered yet', () => {
    const { root, write } = fixture()
    write('views/Unregistered.vue', "<template>{{ i18ns.t('relay.missing') }}</template>")
    expect(() => analyzeLocaleCoverage(root, [])).toThrow('undefined translation relay.missing')
  })

  it('reports TypeScript errors for unknown keys, incomplete translations and missing parameters', () => {
    const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
    const fixtureFile = path.join(frontendRoot, 'i18n-type-fixture.ts')
    const fixtureSource = [
      "import type { I18nAvailableKey, TranslationIssues } from './src/locales/schema'",
      "import type { Assert, Equal } from './src/types/common'",
      "const invalidKey: I18nAvailableKey = 'missing.fixture.key'",
      "type MissingKey = Assert<Equal<TranslationIssues<{ title: 'Title' }, {}>, never>>",
      "type MissingParam = Assert<Equal<TranslationIssues<{ count: '{count}' }, { count: 'Count' }>, never>>",
    ].join('\n')
    const options: ts.CompilerOptions = {
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      target: ts.ScriptTarget.ESNext,
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      paths: { '@/*': [path.join(frontendRoot, 'src/*')] },
    }
    const host = ts.createCompilerHost(options)
    const getSourceFile = host.getSourceFile.bind(host)
    host.getSourceFile = (file, ...args) =>
      path.resolve(file) === path.resolve(fixtureFile)
        ? ts.createSourceFile(file, fixtureSource, options.target!, true)
        : getSourceFile(file, ...args)
    const program = ts.createProgram([fixtureFile], options, host)
    const sourceFile = program.getSourceFile(fixtureFile)
    expect(sourceFile).toBeDefined()
    const errors = program.getSemanticDiagnostics(sourceFile)
    expect(errors.map((error) => error.code).sort()).toEqual([2322, 2344, 2344])
  }, 20_000)

  it('rejects malformed message syntax instead of letting runtime translation fall back to its key', () => {
    expect(messageSyntaxErrors('Use {{accountToken}}')).toContain('Not allowed nest placeholder')
    expect(messageSyntaxErrors("Use {'{{accountToken}}'}")).toEqual([])
  })

  it('preserves named parameters while excluding English suffixes and literal examples', () => {
    expect(interpolationKeys("{count} day{s}: /models/{'{model}'}/{id} — {count}")).toEqual([
      'count',
      'id',
    ])
  })
})
