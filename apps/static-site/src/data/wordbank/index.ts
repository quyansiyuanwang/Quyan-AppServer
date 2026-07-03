import type { QuizQuestion, VocabularyWord, WordCategory } from '@/types/learning'
import { parseMemoryWordsFromText } from './memoryTextParser'
import { wordCategories } from './categories'

export const ALL_WORD_CATEGORY_ID = 'all'

type BankModule<T> = Record<string, T[] | unknown>

interface MemoryShard {
  id: string
  path: string
  count: number
}

interface MemoryShardIndexPayload {
  total?: number
  shards?: unknown
}

interface MemoryParseWorkerRequest {
  requestId: number
  categoryId: string
  text: string
}

interface MemoryParseWorkerResponse {
  requestId: number
  words: VocabularyWord[]
}

interface MemoryParsePendingItem {
  resolve: (words: VocabularyWord[]) => void
  reject: (reason?: unknown) => void
}

const memoryBasePaths: Record<string, string> = wordCategories.reduce<Record<string, string>>(
  (output, category) => {
    output[category.id] = `wordbank/${category.id}`
    return output
  },
  {},
)

const memoryCache = new Map<string, VocabularyWord[]>()
const memoryShardIndexCache = new Map<string, MemoryShard[]>()
const memoryShardLoadedCountCache = new Map<string, number>()
const memoryShardTotalCountCache = new Map<string, number>()
const memoryParserPending = new Map<number, MemoryParsePendingItem>()

let memoryParserWorker: Worker | null = null
let memoryParserRequestId = 0

const getCategoryIdFromPath = (filePath: string): string => {
  const matched = filePath.match(/^\.\/([^/]+)\//)
  return matched?.[1] ?? 'unknown'
}

const getArrayExport = <T>(module: BankModule<T>): T[] => {
  for (const value of Object.values(module)) {
    if (Array.isArray(value)) return value as T[]
  }
  return []
}

const mapBankModules = <T>(modules: Record<string, BankModule<T>>): Record<string, T[]> => {
  const output: Record<string, T[]> = {}

  for (const [filePath, moduleValue] of Object.entries(modules)) {
    const categoryId = getCategoryIdFromPath(filePath)
    output[categoryId] = getArrayExport(moduleValue)
  }

  return output
}

const practiceModules = import.meta.glob('./*/practice.ts', { eager: true }) as Record<
  string,
  BankModule<QuizQuestion>
>

const practiceBankByCategory: Record<string, QuizQuestion[]> =
  mapBankModules<QuizQuestion>(practiceModules)

const dedupeById = <T extends { id: string }>(items: T[]): T[] => {
  const map = new Map<string, T>()
  for (const item of items) {
    map.set(item.id, item)
  }
  return [...map.values()]
}

const flatten = <T extends { id: string }>(bank: Record<string, T[]>, categoryId: string): T[] => {
  if (categoryId === ALL_WORD_CATEGORY_ID) {
    return dedupeById(Object.values(bank).flat())
  }

  return dedupeById(bank[categoryId] ?? [])
}

const toSafeCount = (value: unknown): number => {
  if (typeof value !== 'number') return 0
  if (!Number.isFinite(value) || value < 0) return 0
  return Math.floor(value)
}

const getMemoryIndexPath = (categoryId: string): string => {
  const basePath = memoryBasePaths[categoryId]
  return `${basePath}/memory.index.json`
}

const getMemoryFallbackTextPath = (categoryId: string): string => {
  const basePath = memoryBasePaths[categoryId]
  return `${basePath}/memory.txt`
}

const normalizeShardPath = (rawPath: string, categoryId: string): string => {
  const trimmed = rawPath.trim().replace(/^\/+/, '')
  if (!trimmed) return ''

  if (trimmed.includes('/')) {
    return trimmed
  }

  const basePath = memoryBasePaths[categoryId]
  if (!basePath) return trimmed
  return `${basePath}/${trimmed}`
}

const toMemoryShard = (value: unknown, categoryId: string): MemoryShard | null => {
  if (!value || typeof value !== 'object') return null

  const raw = value as Partial<MemoryShard>
  const normalizedPath =
    typeof raw.path === 'string' ? normalizeShardPath(raw.path, categoryId) : ''

  if (!normalizedPath) return null

  return {
    id: typeof raw.id === 'string' && raw.id.trim().length > 0 ? raw.id.trim() : normalizedPath,
    path: normalizedPath,
    count: toSafeCount(raw.count),
  }
}

const buildFallbackShards = (categoryId: string): MemoryShard[] => {
  const fallbackPath = getMemoryFallbackTextPath(categoryId)
  if (!fallbackPath) return []

  return [
    {
      id: 'full',
      path: fallbackPath,
      count: 0,
    },
  ]
}

const terminateMemoryParserWorker = (): void => {
  if (!memoryParserWorker) return

  memoryParserWorker.terminate()
  memoryParserWorker = null

  for (const pending of memoryParserPending.values()) {
    pending.reject(new Error('Memory parser worker terminated unexpectedly.'))
  }
  memoryParserPending.clear()
}

const getMemoryParserWorker = (): Worker | null => {
  if (typeof Worker === 'undefined') return null
  if (memoryParserWorker) return memoryParserWorker

  try {
    const worker = new Worker(new URL('../../workers/wordbankParser.worker.ts', import.meta.url), {
      type: 'module',
    })

    worker.addEventListener('message', (event: MessageEvent<MemoryParseWorkerResponse>) => {
      const payload = event.data
      const pending = memoryParserPending.get(payload.requestId)
      if (!pending) return

      memoryParserPending.delete(payload.requestId)
      pending.resolve(payload.words)
    })

    worker.addEventListener('error', () => {
      terminateMemoryParserWorker()
    })

    worker.addEventListener('messageerror', () => {
      terminateMemoryParserWorker()
    })

    memoryParserWorker = worker
    return worker
  } catch {
    return null
  }
}

const parseMemoryWords = (text: string, categoryId: string): Promise<VocabularyWord[]> => {
  const worker = getMemoryParserWorker()

  if (!worker) {
    return Promise.resolve(parseMemoryWordsFromText(text, categoryId))
  }

  const requestId = memoryParserRequestId + 1
  memoryParserRequestId = requestId

  return new Promise<VocabularyWord[]>((resolve, reject) => {
    memoryParserPending.set(requestId, { resolve, reject })

    const payload: MemoryParseWorkerRequest = {
      requestId,
      categoryId,
      text,
    }

    worker.postMessage(payload)
  }).catch(() => parseMemoryWordsFromText(text, categoryId))
}

const resolvePublicAssetPath = (assetPath: string): string => {
  const base = import.meta.env.BASE_URL ?? '/'
  const normalizedBase = base.endsWith('/') ? base : `${base}/`
  return `${normalizedBase}${assetPath.replace(/^\/+/, '')}`
}

const loadMemoryShardIndex = async (categoryId: string): Promise<MemoryShard[]> => {
  const cached = memoryShardIndexCache.get(categoryId)
  if (cached) return cached

  const basePath = memoryBasePaths[categoryId]
  if (!basePath) {
    memoryShardIndexCache.set(categoryId, [])
    memoryShardTotalCountCache.set(categoryId, 0)
    return []
  }

  const fallback = buildFallbackShards(categoryId)

  try {
    const response = await fetch(resolvePublicAssetPath(getMemoryIndexPath(categoryId)), {
      cache: 'force-cache',
    })

    if (!response.ok) {
      memoryShardIndexCache.set(categoryId, fallback)
      memoryShardTotalCountCache.set(categoryId, 0)
      return fallback
    }

    const payload = (await response.json()) as MemoryShardIndexPayload
    const shards = Array.isArray(payload.shards)
      ? payload.shards
          .map((item) => toMemoryShard(item, categoryId))
          .filter((item): item is MemoryShard => item !== null)
      : []

    if (shards.length === 0) {
      memoryShardIndexCache.set(categoryId, fallback)
      memoryShardTotalCountCache.set(categoryId, 0)
      return fallback
    }

    const totalFromIndex = toSafeCount(payload.total)
    const totalFromShards = shards.reduce((sum, shard) => sum + shard.count, 0)
    const total = totalFromIndex > 0 ? totalFromIndex : totalFromShards

    memoryShardIndexCache.set(categoryId, shards)
    memoryShardTotalCountCache.set(categoryId, total)
    return shards
  } catch {
    memoryShardIndexCache.set(categoryId, fallback)
    memoryShardTotalCountCache.set(categoryId, 0)
    return fallback
  }
}

const fetchMemoryShardWords = async (
  categoryId: string,
  shard: MemoryShard,
): Promise<VocabularyWord[]> => {
  try {
    const response = await fetch(resolvePublicAssetPath(shard.path), {
      cache: 'force-cache',
    })

    if (!response.ok) return []

    const text = await response.text()
    return parseMemoryWords(text, categoryId)
  } catch {
    return []
  }
}

const ensureMemoryWordsLoaded = async (
  categoryId: string,
  requiredCount = Number.POSITIVE_INFINITY,
): Promise<{ words: VocabularyWord[]; total: number; hasMore: boolean }> => {
  const shards = await loadMemoryShardIndex(categoryId)

  let words = memoryCache.get(categoryId) ?? []
  let loadedShardCount = memoryShardLoadedCountCache.get(categoryId) ?? 0

  while (words.length < requiredCount && loadedShardCount < shards.length) {
    const nextShard = shards[loadedShardCount]
    if (!nextShard) break

    const shardWords = await fetchMemoryShardWords(categoryId, nextShard)
    words = dedupeById([...words, ...shardWords])
    loadedShardCount += 1

    memoryCache.set(categoryId, words)
    memoryShardLoadedCountCache.set(categoryId, loadedShardCount)
  }

  const totalFromIndex = memoryShardTotalCountCache.get(categoryId) ?? 0
  const total = Math.max(totalFromIndex, words.length)
  const hasMore = loadedShardCount < shards.length || words.length < total

  return {
    words,
    total,
    hasMore,
  }
}

const discoveredCategoryIds = new Set<string>([
  ...Object.keys(memoryBasePaths),
  ...Object.keys(practiceBankByCategory),
])

export const listWordCategories = (): WordCategory[] => {
  const categoryMap = new Map<string, WordCategory>(wordCategories.map((item) => [item.id, item]))

  for (const categoryId of discoveredCategoryIds) {
    if (categoryMap.has(categoryId)) continue
    categoryMap.set(categoryId, {
      id: categoryId,
      label: categoryId.toUpperCase(),
      description: `${categoryId.toUpperCase()} imported category`,
    })
  }

  return [...categoryMap.values()]
}

export interface VocabularyWordsChunk {
  words: VocabularyWord[]
  total: number
  hasMore: boolean
}

export const getVocabularyWordsByCategory = (
  categoryId = ALL_WORD_CATEGORY_ID,
): Promise<VocabularyWord[]> => {
  if (categoryId === ALL_WORD_CATEGORY_ID) {
    const categories = [...Object.keys(memoryBasePaths)]
    return Promise.all(categories.map((id) => ensureMemoryWordsLoaded(id))).then((items) => {
      const allWords = items.flatMap((item) => item.words)
      return dedupeById(allWords)
    })
  }

  return ensureMemoryWordsLoaded(categoryId).then((result) => result.words)
}

export const getVocabularyWordsChunkByCategory = async (
  categoryId = ALL_WORD_CATEGORY_ID,
  limit = 20,
): Promise<VocabularyWordsChunk> => {
  const safeLimit = Math.max(1, Math.floor(limit))

  if (categoryId === ALL_WORD_CATEGORY_ID) {
    const words = await getVocabularyWordsByCategory(categoryId)
    return {
      words: words.slice(0, safeLimit),
      total: words.length,
      hasMore: words.length > safeLimit,
    }
  }

  const result = await ensureMemoryWordsLoaded(categoryId, safeLimit)

  return {
    words: result.words.slice(0, safeLimit),
    total: result.total,
    hasMore: result.hasMore || result.words.length > safeLimit,
  }
}

export const getPracticeQuestionsByCategory = (
  categoryId = ALL_WORD_CATEGORY_ID,
): QuizQuestion[] => {
  return flatten(practiceBankByCategory, categoryId)
}

export const getMemoryGameWords = (
  categoryId = ALL_WORD_CATEGORY_ID,
  limit = 6,
): Promise<VocabularyWord[]> => {
  return getVocabularyWordsByCategory(categoryId).then((words) => {
    if (words.length <= limit) return words
    return words.slice(0, limit)
  })
}
