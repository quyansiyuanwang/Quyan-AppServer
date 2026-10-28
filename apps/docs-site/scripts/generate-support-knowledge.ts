import { createHash } from 'node:crypto'
import { readdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  splitKnowledgeSections,
  cleanKnowledgeMarkdown,
  iamKnowledgeSections,
  iamKnowledgeSearchText,
} from './support-knowledge'

const docsDirectory = join(dirname(fileURLToPath(import.meta.url)), '..')
const contentDirectory = join(docsDirectory, 'src', 'content')
const publicDirectory = join(docsDirectory, 'public')
const manifestPath = join(publicDirectory, 'support-knowledge.json')
const locales = ['zh-CN', 'en'] as const
const generatedFiles = new Set<string>(['support-knowledge.json'])

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const writeJson = async (filename: string, value: unknown) => {
  generatedFiles.add(filename)
  await writeFile(join(publicDirectory, filename), `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

const localeReferences: Record<string, { indexUrl: string; indexHash: string }> = {}
for (const locale of locales) {
  const documents = []
  const directory = join(contentDirectory, locale)
  for (const file of (await readdir(directory)).filter((name) => name.endsWith('.md')).sort()) {
    const slug = file.slice(0, -3)
    const markdown = await readFile(join(directory, file), 'utf8')
    const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || slug
    const documentId = `${locale}:${slug}`
    const sections = [
      ...splitKnowledgeSections(markdown, title),
      ...(slug === 'ram-management' ? iamKnowledgeSections(locale) : []),
    ].map((section, index) => ({
      id: `${documentId}:${index}`,
      heading: section.heading,
      summary: section.content.slice(0, 360),
      content: section.content,
    }))
    const documentPayload = {
      schemaVersion: 2,
      id: documentId,
      slug,
      title,
      locale,
      path: `/${locale}/${slug}`,
      sections,
    }
    const documentHash = hash(documentPayload)
    const safeSlug = slug.replace(/[^a-z0-9_-]/gi, '_')
    const documentFilename = `support-knowledge.document.${locale}.${safeSlug}.${documentHash}.json`
    await writeJson(documentFilename, documentPayload)
    documents.push({
      id: documentId,
      slug,
      title,
      locale,
      path: `/${locale}/${slug}`,
      summary: [
        cleanKnowledgeMarkdown(markdown).slice(0, 480),
        ...(slug === 'ram-management' ? [iamKnowledgeSearchText()] : []),
      ].join('\n'),
      sectionCount: sections.length,
      documentUrl: `./${documentFilename}`,
      documentHash: `sha256-${documentHash}`,
    })
  }
  const indexPayload = { schemaVersion: 2, locale, documents }
  const indexHash = hash(indexPayload)
  const indexFilename = `support-knowledge.index.${locale}.${indexHash}.json`
  await writeJson(indexFilename, indexPayload)
  localeReferences[locale] = {
    indexUrl: `./${indexFilename}`,
    indexHash: `sha256-${indexHash}`,
  }
}

const manifest = {
  schemaVersion: 2,
  version: `sha256-${hash(localeReferences)}`,
  locales: localeReferences,
}
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

// A generated manifest must never leave old hashed payloads behind. This covers
// the former flat chunks file and all current index/document shards.
const staleKnowledgeFiles = (await readdir(publicDirectory)).filter(
  (file) =>
    file.startsWith('support-knowledge.') &&
    file.endsWith('.json') &&
    file !== 'support-knowledge.json' &&
    !generatedFiles.has(file),
)
await Promise.all(staleKnowledgeFiles.map((file) => unlink(join(publicDirectory, file))))

console.log(`Generated hierarchical support knowledge indexes (${manifest.version}).`)
