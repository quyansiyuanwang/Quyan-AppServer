export type SupportMessageRole = 'user' | 'assistant'

export interface SupportCitation {
  slug: string
  title: string
  url: string
}

export type SupportStreamEvent =
  | { type: 'delta'; content: string }
  | { type: 'citations'; citations: SupportCitation[] }
  | { type: 'complete'; done: true }
  | { type: 'error'; error: string; done: true }
  | { type: 'done'; done: true }
