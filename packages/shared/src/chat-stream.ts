export interface ChatStreamMessage {
  id: string
  conversationId: string
  role: string
  content: string
  model: string | null
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  cost?: number | null
  completionStatus: string
  createTime: string
}

export type ChatStreamEvent =
  | { type: 'delta'; content: string; done: false }
  | { type: 'complete'; message: ChatStreamMessage; done: true }
  | { type: 'error'; error: string; done: true }
  | { type: 'done'; done: true }
