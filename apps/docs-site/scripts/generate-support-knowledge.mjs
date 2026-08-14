import { readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const docsDirectory = join(dirname(fileURLToPath(import.meta.url)), '..')
const contentDirectory = join(docsDirectory, 'src', 'content')
const outputPath = join(docsDirectory, 'public', 'support-knowledge.json')

const clean = (markdown) =>
  markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
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

const knowledge = []
for (const locale of ['zh-CN', 'en']) {
  const directory = join(contentDirectory, locale)
  for (const file of (await readdir(directory)).filter((name) => name.endsWith('.md')).sort()) {
    const slug = file.slice(0, -3)
    const markdown = await readFile(join(directory, file), 'utf8')
    const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || slug
    for (const content of split(clean(markdown)))
      knowledge.push({ slug, title, locale, path: `/${locale}/${slug}`, content })
  }
}
await writeFile(outputPath, `${JSON.stringify(knowledge, null, 2)}\n`, 'utf8')
console.log(`Generated ${knowledge.length} support knowledge chunks.`)
