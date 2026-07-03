import fs from 'node:fs'
import path from 'node:path'

const SUPPORTED_TYPES = ['memory', 'practice']

const toSlug = (value) => {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

const toIdentifier = (value) => {
  const normalized = value
    .replace(/[^a-zA-Z0-9_$]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))
    .replace(/^[^a-zA-Z_$]/, '_')

  return normalized.length > 0 ? normalized : '_category'
}

const escapeString = (value) => {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

const toTsLiteral = (value, depth = 0) => {
  const indent = '  '.repeat(depth)
  const nextIndent = '  '.repeat(depth + 1)

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    const entries = value.map((item) => `${nextIndent}${toTsLiteral(item, depth + 1)}`)
    return `[
${entries.join(',\n')}
${indent}]`
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, val]) => val !== undefined)
    if (entries.length === 0) return '{}'

    const lines = entries.map(([key, val]) => {
      const keyLiteral = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key) ? key : `'${escapeString(key)}'`
      return `${nextIndent}${keyLiteral}: ${toTsLiteral(val, depth + 1)}`
    })

    return `{
${lines.join(',\n')}
${indent}}`
  }

  if (typeof value === 'string') return `'${escapeString(value)}'`
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return 'null'
}

const printUsage = () => {
  console.log(`
Usage:
  node scripts/import-wordbank-text.js --input <path> --category <id> --type <memory|practice> [--output <path>]

Examples:
  node scripts/import-wordbank-text.js --input imports/cet4-memory.txt --category cet4 --type memory
  node scripts/import-wordbank-text.js --input imports/cet4-memory.txt --category cet4 --type memory --output public/wordbank/cet4/memory.txt
  node scripts/import-wordbank-text.js --input imports/cet6-practice.txt --category cet6 --type practice

Memory import default behavior (without --output):
  - Generates sharded files: public/wordbank/<category>/memory.<a-z|misc>.txt
  - Generates index file: public/wordbank/<category>/memory.index.json
`)
}

const parseArgs = (argv) => {
  const result = {
    input: '',
    category: '',
    type: '',
    output: '',
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    const next = argv[i + 1]

    if (token === '--help' || token === '-h') {
      printUsage()
      process.exit(0)
    }

    if (token === '--input' && next) {
      result.input = next
      i += 1
      continue
    }

    if (token === '--category' && next) {
      result.category = next
      i += 1
      continue
    }

    if (token === '--type' && next) {
      result.type = next
      i += 1
      continue
    }

    if (token === '--output' && next) {
      result.output = next
      i += 1
      continue
    }
  }

  return result
}

const parseMemoryWords = (text, category) => {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^单词记忆|词汇记忆|vocabulary memory/i.test(line))

  const sourceText = lines.join('\n')

  const entryPattern = /([A-Za-z][A-Za-z' -]*)\s*[\/／]\s*([^\/／\n]+?)\s*[\/／]\s*(.+?)(?=(?:\n|\s+[A-Za-z][A-Za-z' -]*\s*[\/／]\s*[^\/／\n]+?\s*[\/／])|$)/gs

  const idCount = new Map()
  const items = []

  for (const match of sourceText.matchAll(entryPattern)) {
    const word = match[1]?.trim()
    const phoneticRaw = match[2]?.trim().replace(/^\/+|\/+$/g, '')
    const tailRaw = match[3]?.replace(/\s+/g, ' ').trim()

    if (!word || !phoneticRaw || !tailRaw) continue

    const tail = tailRaw.replace(/^[.。;；:：]+\s*/, '')
    const posPattern = tail.match(/^([a-z]+\.)\s*(.+)$/i)
    const partOfSpeech = posPattern?.[1]
    const meaning = (posPattern?.[2] ?? tail).trim()
    const phonetic = `/${phoneticRaw}/`

    const baseId = `${category}-${toSlug(word)}`
    const nextIndex = (idCount.get(baseId) ?? 0) + 1
    idCount.set(baseId, nextIndex)

    items.push({
      id: nextIndex === 1 ? baseId : `${baseId}-${nextIndex}`,
      word,
      phonetic,
      partOfSpeech,
      meaning,
      rawLine: `${word}/ ${phoneticRaw}/ ${tail}`,
      category,
    })
  }

  return items
}

const isQuestionLine = (line) => {
  return /^\d+\s*[、.．)）]/.test(line) || (/____/.test(line) && /\?$/.test(line) === false)
}

const isOptionLine = (line) => {
  return /^[A-DＡ-Ｄ]\s*[)）.．、:：]/.test(line)
}

const normalizeOptionLine = (line) => {
  return line
    .replace(/^[Ａ-Ｄ]/, (char) => String.fromCharCode(char.charCodeAt(0) - 65248))
    .replace(/^[A-D]\s*[)）.．、:：]\s*/, '')
    .trim()
}

const parsePracticeQuestions = (text, category) => {
  const lines = text.split(/\r?\n/).map((line) => line.trim())
  const items = []

  let i = 0
  while (i < lines.length) {
    const current = lines[i]

    if (!current || /^词汇练习|practice/i.test(current)) {
      i += 1
      continue
    }

    if (!isQuestionLine(current)) {
      i += 1
      continue
    }

    const questionTitle = current.replace(/^\d+\s*[、.．)）]\s*/, '').trim()
    const questionParts = [questionTitle]
    i += 1

    while (i < lines.length && lines[i] && !isOptionLine(lines[i]) && !isQuestionLine(lines[i])) {
      if (!/^答案[:：]|^解析[:：]/.test(lines[i])) {
        questionParts.push(lines[i])
      }
      i += 1
    }

    const options = []
    while (i < lines.length && isOptionLine(lines[i])) {
      options.push(normalizeOptionLine(lines[i]))
      i += 1
    }

    let answerLetter = ''
    let explanation = 'Imported question. Please review answer and explanation.'

    while (i < lines.length && lines[i] && !isQuestionLine(lines[i])) {
      const line = lines[i]
      const answerMatch = line.match(/^答案[:：]?\s*([A-D])/i)
      const explanationMatch = line.match(/^解析[:：]?\s*(.+)$/)

      if (answerMatch) answerLetter = answerMatch[1].toUpperCase()
      if (explanationMatch) explanation = explanationMatch[1].trim()

      if (isOptionLine(line)) break
      i += 1
    }

    if (options.length < 2) {
      continue
    }

    let correctIndex = 0
    if (answerLetter) {
      const index = 'ABCD'.indexOf(answerLetter)
      if (index >= 0 && index < options.length) {
        correctIndex = index
      }
    }

    items.push({
      id: `${category}-q${items.length + 1}`,
      question: questionParts.join(' ').replace(/\s+/g, ' ').trim(),
      choices: options,
      correctIndex,
      explanation,
      level: 'medium',
      category,
    })
  }

  return items
}

const buildModuleContent = (category, type, items) => {
  const typeMap = {
    memory: 'VocabularyWord',
    practice: 'QuizQuestion',
  }

  const suffixMap = {
    memory: 'MemoryWords',
    practice: 'PracticeQuestions',
  }

  const identifier = `${toIdentifier(category)}${suffixMap[type]}`
  const typeName = typeMap[type]

  return `import type { ${typeName} } from '@/types/learning'\n\nexport const ${identifier}: ${typeName}[] = ${toTsLiteral(items)}\n`
}

const buildMemoryTextContent = (items) => {
  const lines = items.map((item) => {
    if (item.rawLine && item.rawLine.trim().length > 0) {
      return item.rawLine.trim()
    }

    const phonetic = String(item.phonetic || '').replace(/^\/+|\/+$/g, '')
    const pos = item.partOfSpeech ? `${item.partOfSpeech} ` : ''
    return `${item.word}/ ${phonetic}/ ${pos}${item.meaning}`.trim()
  })

  return `${lines.join('\n')}\n`
}

const MEMORY_SHARD_KEYS = 'abcdefghijklmnopqrstuvwxyz'.split('')

const getMemoryShardKey = (word) => {
  const first = String(word || '')
    .trim()
    .charAt(0)
    .toLowerCase()

  return MEMORY_SHARD_KEYS.includes(first) ? first : 'misc'
}

const buildMemoryShardBundles = (items) => {
  const grouped = new Map()

  for (const item of items) {
    const key = getMemoryShardKey(item.word)
    const list = grouped.get(key) ?? []
    list.push(item)
    grouped.set(key, list)
  }

  const orderedKeys = [...MEMORY_SHARD_KEYS, 'misc'].filter((key) => {
    return (grouped.get(key)?.length ?? 0) > 0
  })

  return orderedKeys.map((key) => {
    const shardItems = grouped.get(key) ?? []
    return {
      key,
      fileName: `memory.${key}.txt`,
      itemCount: shardItems.length,
      content: buildMemoryTextContent(shardItems),
    }
  })
}

const writeMemoryShardBundle = ({ outputDir, category, items }) => {
  const shardBundles = buildMemoryShardBundles(items)
  fs.mkdirSync(outputDir, { recursive: true })

  const staleMemoryFiles = fs
    .readdirSync(outputDir)
    .filter((name) => {
      return (
        name === 'memory.txt' ||
        name === 'memory.index.json' ||
        /^memory\.[a-z]+\.txt$/i.test(name) ||
        name === 'memory.misc.txt'
      )
    })

  for (const fileName of staleMemoryFiles) {
    fs.rmSync(path.join(outputDir, fileName), { force: true })
  }

  for (const shard of shardBundles) {
    const shardPath = path.join(outputDir, shard.fileName)
    fs.writeFileSync(shardPath, shard.content, 'utf8')
  }

  const indexPayload = {
    version: 1,
    category,
    total: items.length,
    shards: shardBundles.map((shard) => ({
      id: shard.key,
      path: `wordbank/${category}/${shard.fileName}`,
      count: shard.itemCount,
    })),
  }

  const indexPath = path.join(outputDir, 'memory.index.json')
  fs.writeFileSync(indexPath, `${JSON.stringify(indexPayload, null, 2)}\n`, 'utf8')

  return {
    shardCount: shardBundles.length,
    indexPath,
  }
}

const defaultOutputPath = (category, type) => {
  if (type === 'memory') {
    return `public/wordbank/${category}/memory.txt`
  }

  return `src/data/wordbank/${category}/${type}.ts`
}

const run = () => {
  const args = parseArgs(process.argv.slice(2))

  if (!args.input || !args.category || !args.type || !SUPPORTED_TYPES.includes(args.type)) {
    printUsage()
    process.exit(1)
  }

  const inputPath = path.resolve(process.cwd(), args.input)
  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`)
    process.exit(1)
  }

  const text = fs.readFileSync(inputPath, 'utf8')

  let parsed = []
  if (args.type === 'memory') parsed = parseMemoryWords(text, args.category)
  if (args.type === 'practice') parsed = parsePracticeQuestions(text, args.category)

  if (parsed.length === 0) {
    console.error('No valid entries parsed. Please check source text format.')
    process.exit(1)
  }

  if (args.type === 'memory' && !args.output) {
    const outputDir = path.resolve(process.cwd(), `public/wordbank/${args.category}`)
    const result = writeMemoryShardBundle({
      outputDir,
      category: args.category,
      items: parsed,
    })

    console.log(`Imported ${parsed.length} entries to ${outputDir}`)
    console.log(
      `Generated ${result.shardCount} shard files and index: ${path.relative(process.cwd(), result.indexPath)}`,
    )
    return
  }

  const outputPath = args.output
    ? path.resolve(process.cwd(), args.output)
    : path.resolve(process.cwd(), defaultOutputPath(args.category, args.type))

  const shouldOutputText = args.type === 'memory' && path.extname(outputPath).toLowerCase() === '.txt'
  const content = shouldOutputText
    ? buildMemoryTextContent(parsed)
    : buildModuleContent(args.category, args.type, parsed)

  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, content, 'utf8')

  console.log(`Imported ${parsed.length} entries to ${outputPath}`)

  if (args.type === 'memory') {
    console.log('Tip: omit --output to generate A-Z shards with memory.index.json automatically.')
  } else {
    console.log('Tip: if this is a new category, add it in src/data/wordbank/categories.ts for display labels.')
  }
}

run()
