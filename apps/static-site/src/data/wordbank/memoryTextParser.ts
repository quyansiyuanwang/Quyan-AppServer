import type { VocabularyWord } from '@/types/learning'

const dedupeById = <T extends { id: string }>(items: T[]): T[] => {
  const map = new Map<string, T>()
  for (const item of items) {
    map.set(item.id, item)
  }
  return [...map.values()]
}

const toSlug = (value: string): string => {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return normalized.length > 0 ? normalized : 'word'
}

export const parseMemoryWordsFromText = (text: string, categoryId: string): VocabularyWord[] => {
  const sourceText = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^单词记忆|词汇记忆|vocabulary memory/i.test(line))
    .join('\n')

  const entryPattern =
    /([A-Za-z][A-Za-z' -]*)\s*[\/／]\s*([^\/／\n]+?)\s*[\/／]\s*(.+?)(?=(?:\n|\s+[A-Za-z][A-Za-z' -]*\s*[\/／]\s*[^\/／\n]+?\s*[\/／])|$)/gs

  const idCount = new Map<string, number>()
  const output: VocabularyWord[] = []

  for (const match of sourceText.matchAll(entryPattern)) {
    const word = match[1]?.trim()
    const phoneticRaw = match[2]?.trim().replace(/^\/+|\/+$/g, '')
    const tailRaw = match[3]?.replace(/\s+/g, ' ').trim()

    if (!word || !phoneticRaw || !tailRaw) continue

    const tail = tailRaw.replace(/^[.。;；:：]+\s*/, '')
    const partOfSpeechMatch = tail.match(/^([a-z]+\.)\s*(.+)$/i)
    const partOfSpeech = partOfSpeechMatch?.[1]
    const meaning = (partOfSpeechMatch?.[2] ?? tail).trim()

    const baseId = `${categoryId}-${toSlug(word)}`
    const nextIndex = (idCount.get(baseId) ?? 0) + 1
    idCount.set(baseId, nextIndex)

    output.push({
      id: nextIndex === 1 ? baseId : `${baseId}-${nextIndex}`,
      word,
      phonetic: `/${phoneticRaw}/`,
      partOfSpeech,
      meaning,
      rawLine: `${word}/ ${phoneticRaw}/ ${tail}`,
      category: categoryId,
    })
  }

  return dedupeById(output)
}
