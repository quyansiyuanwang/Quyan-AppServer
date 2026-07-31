import { describe, expect, it, vi } from 'vitest'
import { createSseClient, readSseStream, SseStreamError } from '@/utils/streaming/sseStream'

const encoder = new TextEncoder()

function sseResponse(chunks: Uint8Array[], contentType = 'text/event-stream') {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk)
        controller.close()
      },
    }),
    { headers: { 'content-type': contentType } },
  )
}

describe('readSseStream', () => {
  it('parses split UTF-8, multi-line data and a terminal done marker', async () => {
    const bytes = encoder.encode('data: {"text":\ndata: "你好"}\n\ndata: [DONE]\n\n')
    const events = [] as Array<{ type: 'data'; value: { text: string } } | { type: 'done' }>
    for await (const event of readSseStream({
      url: 'https://example.test/stream',
      init: {},
      decode: (data) => JSON.parse(data) as { text: string },
      fetchImpl: async () => sseResponse([bytes.slice(0, 18), bytes.slice(18)]),
    }))
      events.push(event)

    expect(events).toEqual([{ type: 'data', value: { text: '你好' } }, { type: 'done' }])
  })

  it('decodes a final frame without a trailing blank line', async () => {
    const events = [] as Array<{ type: 'data'; value: { ok: boolean } } | { type: 'done' }>
    for await (const event of readSseStream({
      url: 'https://example.test/stream',
      init: {},
      decode: (data) => JSON.parse(data) as { ok: boolean },
      fetchImpl: async () => sseResponse([encoder.encode('data: {"ok":true}')]),
    }))
      events.push(event)
    expect(events).toEqual([{ type: 'data', value: { ok: true } }])
  })

  it('classifies invalid payloads and non-SSE responses as protocol failures', async () => {
    const invalid = readSseStream({
      url: 'https://example.test/stream',
      init: {},
      decode: (data) => JSON.parse(data),
      fetchImpl: async () => sseResponse([encoder.encode('data: nope\n\n')]),
    }).next()
    await expect(invalid).rejects.toMatchObject<SseStreamError>({ kind: 'protocol' })

    const nonSse = readSseStream({
      url: 'https://example.test/stream',
      init: {},
      decode: JSON.parse,
      fetchImpl: async () => sseResponse([], 'application/json'),
    }).next()
    await expect(nonSse).rejects.toMatchObject<SseStreamError>({ kind: 'protocol' })
  })

  it('classifies HTTP and network failures separately', async () => {
    const http = readSseStream({
      url: 'https://example.test/stream',
      init: {},
      decode: JSON.parse,
      fetchImpl: async () => new Response('Unauthorized', { status: 401 }),
    }).next()
    await expect(http).rejects.toMatchObject<SseStreamError>({ kind: 'http', status: 401 })

    const network = readSseStream({
      url: 'https://example.test/stream',
      init: {},
      decode: JSON.parse,
      fetchImpl: async () => {
        throw new TypeError('Network unavailable')
      },
    }).next()
    await expect(network).rejects.toMatchObject<SseStreamError>({ kind: 'network' })
  })

  it('classifies aborted fetches', async () => {
    const controller = new AbortController()
    controller.abort()
    const next = readSseStream({
      url: 'https://example.test/stream',
      init: {},
      decode: JSON.parse,
      signal: controller.signal,
      fetchImpl: async () => {
        throw new DOMException('Aborted', 'AbortError')
      },
    }).next()
    await expect(next).rejects.toMatchObject<SseStreamError>({ kind: 'aborted' })
  })

  it('composes reusable request middleware for arbitrary SSE upstreams', async () => {
    const fetchImpl = vi.fn(async () => sseResponse([encoder.encode('data: {"ok":true}\n\n')]))
    const client = createSseClient<{ apiKey: string }>([
      (request, context) => ({
        ...request,
        url: `${request.url}?stream=1`,
        init: {
          ...request.init,
          headers: { ...request.init.headers, Authorization: `Bearer ${context?.apiKey}` },
        },
      }),
    ])
    const events = [] as Array<{ type: 'data'; value: { ok: boolean } } | { type: 'done' }>
    for await (const event of client.stream({
      url: 'https://upstream.example.test/events',
      init: {},
      context: { apiKey: 'external-key' },
      decode: (data) => JSON.parse(data) as { ok: boolean },
      fetchImpl,
    }))
      events.push(event)

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://upstream.example.test/events?stream=1',
      expect.objectContaining({ headers: { Authorization: 'Bearer external-key' } }),
    )
    expect(events).toEqual([{ type: 'data', value: { ok: true } }])
  })
})
