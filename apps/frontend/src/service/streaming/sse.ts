import { toServiceError } from '@/utils/error-utils'

export interface SSEOptions {
  onMessage: (data: any) => void
  onError?: (error: Error) => void
  onDone?: () => void
}

export class SSEStream {
  private controller: AbortController | null = null

  async connect(url: string, options: RequestInit, callbacks: SSEOptions) {
    this.controller = new AbortController()

    try {
      const response = await fetch(url, {
        ...options,
        signal: this.controller.signal,
      })

      if (!response.ok) throw toServiceError(undefined, `HTTP ${response.status}`)
      if (!response.body) throw toServiceError(undefined, 'No response body')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value)
        const lines = chunk.split('\n')

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            if (data === '[DONE]') {
              callbacks.onDone?.()
              return
            }
            try {
              callbacks.onMessage(JSON.parse(data))
            } catch (e) {
              console.error('SSE parse error:', e)
            }
          }
        }
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        callbacks.onError?.(error)
      }
    }
  }

  abort() {
    this.controller?.abort()
  }
}
