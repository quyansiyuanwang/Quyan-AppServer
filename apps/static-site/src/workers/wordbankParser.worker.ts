/// <reference lib="webworker" />

import type { VocabularyWord } from '@/types/learning'
import { parseMemoryWordsFromText } from '@/data/wordbank/memoryTextParser'

interface MemoryParseWorkerRequest {
  requestId: number
  categoryId: string
  text: string
}

interface MemoryParseWorkerResponse {
  requestId: number
  words: VocabularyWord[]
}

const workerContext: DedicatedWorkerGlobalScope = self as DedicatedWorkerGlobalScope

workerContext.addEventListener('message', (event: MessageEvent<MemoryParseWorkerRequest>) => {
  const { requestId, categoryId, text } = event.data

  const payload: MemoryParseWorkerResponse = {
    requestId,
    words: parseMemoryWordsFromText(text, categoryId),
  }

  workerContext.postMessage(payload)
})
