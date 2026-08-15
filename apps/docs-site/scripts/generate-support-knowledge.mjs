import { createHash } from 'node:crypto'
import { readdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const docsDirectory = join(dirname(fileURLToPath(import.meta.url)), '..')
const contentDirectory = join(docsDirectory, 'src', 'content')
const publicDirectory = join(docsDirectory, 'public')
const manifestPath = join(publicDirectory, 'support-knowledge.json')
const locales = ['zh-CN', 'en']
const generatedFiles = new Set(['support-knowledge.json'])

const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const writeJson = async (filename, value) => {
  generatedFiles.add(filename)
  await writeFile(join(publicDirectory, filename), `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

const clean = (markdown) =>
  markdown
    // Keep command and request examples searchable by support; only Markdown fences are presentation syntax.
    .replace(/```[^\r\n]*(?:\r?\n|$)/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<\/?([a-zA-Z][\w-]*)(?:\s[^>]*)?>/g, ' $1 ')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, '')
    .replace(/[>*_`|]/g, ' ')
    .replace(/\r/g, '')
    .replace(/\n{2,}/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()

const split = (content) => {
  const chunks = []
  let current = ''
  for (const paragraph of content
    .split('\n')
    .map((value) => value.trim())
    .filter(Boolean)) {
    if (current && current.length + paragraph.length + 1 > 1600) {
      chunks.push(current)
      current = ''
    }
    if (paragraph.length <= 1600) current = current ? `${current}\n${paragraph}` : paragraph
    else
      for (let offset = 0; offset < paragraph.length; offset += 1600)
        chunks.push(paragraph.slice(offset, offset + 1600))
  }
  if (current) chunks.push(current)
  return chunks
}

const splitSections = (markdown, fallbackTitle) => {
  const headings = [...markdown.matchAll(/^(#{1,6})\s+(.+?)\s*$/gm)]
  if (headings.length === 0) return [{ heading: fallbackTitle, content: clean(markdown) }]

  return headings.flatMap((match, index) => {
    const start = match.index ?? 0
    const end = headings[index + 1]?.index ?? markdown.length
    const heading = match[2].trim() || fallbackTitle
    return split(clean(markdown.slice(start, end))).map((content) => ({ heading, content }))
  })
}

const localeReferences = {}
for (const locale of locales) {
  const documents = []
  const directory = join(contentDirectory, locale)
  for (const file of (await readdir(directory)).filter((name) => name.endsWith('.md')).sort()) {
    const slug = file.slice(0, -3)
    const markdown = await readFile(join(directory, file), 'utf8')
    const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || slug
    const documentId = `${locale}:${slug}`
    const sections = splitSections(markdown, title).map((section, index) => ({
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
      summary: clean(markdown).slice(0, 480),
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
