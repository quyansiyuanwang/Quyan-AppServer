export type SseStreamErrorKind = 'aborted' | 'network' | 'http' | 'protocol'

export class SseStreamError extends Error {
  constructor(
    public readonly kind: SseStreamErrorKind,
    message: string,
    public readonly status?: number,
  ) {
    super(message)
    this.name = 'SseStreamError'
  }
}

export type SseTransportEvent<T> = { type: 'data'; value: T } | { type: 'done' }

export interface SseRequest {
  url: string
  init: RequestInit
}

export type SseRequestMiddleware<TContext = unknown> = (
  request: SseRequest,
  context: TContext | undefined,
) => SseRequest | Promise<SseRequest>

export interface SseStreamOptions<T, TContext = unknown> extends SseRequest {
  decode: (data: string) => T
  signal?: AbortSignal
  fetchImpl?: typeof fetch
  context?: TContext
  middlewares?: readonly SseRequestMiddleware<TContext>[]
}

const isAbortError = (error: unknown) =>
  error instanceof DOMException
    ? error.name === 'AbortError'
    : (error as { name?: string } | undefined)?.name === 'AbortError'

function readFrameData(frame: string): string | undefined {
  const dataLines = frame
    .split(/\r?\n/)
    .filter((line) => !line.startsWith(':'))
    .flatMap((line) => (line.startsWith('data:') ? [line.slice(5).replace(/^ /, '')] : []))
  return dataLines.length ? dataLines.join('\n') : undefined
}

function takeFrames(buffer: string): { frames: string[]; remainder: string } {
  const frames: string[] = []
  let remainder = buffer
  while (true) {
    const boundary = /\r?\n\r?\n/.exec(remainder)
    if (!boundary || boundary.index == null) return { frames, remainder }
    frames.push(remainder.slice(0, boundary.index))
    remainder = remainder.slice(boundary.index + boundary[0].length)
  }
}

async function applyRequestMiddlewares<TContext>(
  request: SseRequest,
  context: TContext | undefined,
  middlewares: readonly SseRequestMiddleware<TContext>[],
): Promise<SseRequest> {
  let nextRequest = request
  for (const middleware of middlewares) {
    nextRequest = await middleware(nextRequest, context)
    if (!nextRequest || typeof nextRequest.url !== 'string' || !nextRequest.init)
      throw new SseStreamError('protocol', 'SSE request middleware returned an invalid request')
  }
  return nextRequest
}

/** Reads server-sent events without coupling consumers to fetch framing or browser stream cleanup. */
export async function* readSseStream<T, TContext = unknown>(
  options: SseStreamOptions<T, TContext>,
): AsyncGenerator<SseTransportEvent<T>> {
  const fetchImpl = options.fetchImpl ?? fetch
  let request: SseRequest
  try {
    request = await applyRequestMiddlewares(
      { url: options.url, init: options.init },
      options.context,
      options.middlewares ?? [],
    )
  } catch (error) {
    if (error instanceof SseStreamError) throw error
    throw new SseStreamError(
      'protocol',
      error instanceof Error ? error.message : 'SSE request middleware failed',
    )
  }

  let response: Response
  try {
    response = await fetchImpl(request.url, { ...request.init, signal: options.signal })
  } catch (error) {
    if (options.signal?.aborted || isAbortError(error))
      throw new SseStreamError('aborted', 'Streaming request was aborted')
    throw new SseStreamError(
      'network',
      error instanceof Error ? error.message : 'Streaming request failed',
    )
  }

  if (!response.ok) {
    const message = await response.text().catch(() => '')
    throw new SseStreamError('http', message || `HTTP ${response.status}`, response.status)
  }
  if (!response.headers.get('content-type')?.toLowerCase().includes('text/event-stream'))
    throw new SseStreamError('protocol', 'Expected an SSE response')
  if (!response.body) throw new SseStreamError('protocol', 'SSE response has no body')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let terminal = false

  const decodeFrame = (frame: string): T | 'done' | undefined => {
    const data = readFrameData(frame)
    if (data == null) return undefined
    if (data === '[DONE]') return 'done'
    try {
      return options.decode(data)
    } catch (error) {
      throw new SseStreamError(
        'protocol',
        error instanceof Error ? error.message : 'Invalid SSE payload',
      )
    }
  }

  try {
    while (!terminal) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const next = takeFrames(buffer)
      buffer = next.remainder
      for (const frame of next.frames) {
        const event = decodeFrame(frame)
        if (!event) continue
        if (event === 'done') {
          terminal = true
          yield { type: 'done' }
          break
        }
        yield { type: 'data', value: event }
      }
    }

    if (!terminal) {
      buffer += decoder.decode()
      const event = decodeFrame(buffer)
      if (event === 'done') yield { type: 'done' }
      else if (event) yield { type: 'data', value: event }
    }
  } catch (error) {
    if (error instanceof SseStreamError) throw error
    if (options.signal?.aborted || isAbortError(error))
      throw new SseStreamError('aborted', 'Streaming request was aborted')
    throw new SseStreamError(
      'network',
      error instanceof Error ? error.message : 'SSE stream failed',
    )
  } finally {
    if (!terminal || options.signal?.aborted) await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

/** Creates a reusable SSE client whose request middleware can target any upstream service. */
export class SseClient<TContext = unknown> {
  constructor(private readonly middlewares: readonly SseRequestMiddleware<TContext>[] = []) {}

  stream<T>(
    options: Omit<SseStreamOptions<T, TContext>, 'middlewares'> & {
      middlewares?: readonly SseRequestMiddleware<TContext>[]
    },
  ): AsyncGenerator<SseTransportEvent<T>> {
    return readSseStream({
      ...options,
      middlewares: [...this.middlewares, ...(options.middlewares ?? [])],
    })
  }
}

export const createSseClient = <TContext = unknown>(
  middlewares?: readonly SseRequestMiddleware<TContext>[],
) => new SseClient(middlewares)
