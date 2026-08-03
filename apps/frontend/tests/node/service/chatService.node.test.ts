import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAccessTokenMock, prepareStreamingRequestMock } = vi.hoisted(() => ({
  getAccessTokenMock: vi.fn(),
  prepareStreamingRequestMock: vi.fn(),
}))

vi.mock('@/stores/request', () => ({
  getAccessToken: getAccessTokenMock,
  isTokenExpired: () => false,
  useRequestStore: () => ({
    getAxios: vi.fn(),
    prepareStreamingRequest: prepareStreamingRequestMock,
  }),
}))

vi.mock('@/service/authorizationService', () => ({
  authorizationService: { refreshToken: vi.fn() },
}))

import { chatService } from '@/service/chatService'

describe('chatService streaming authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getAccessTokenMock.mockReturnValue('memory-access-token')
    prepareStreamingRequestMock.mockResolvedValue({
      url: 'https://api.example.test/v1/chat/conversations/conversation-1/messages',
      headers: { 'X-Locale': 'zh-CN' },
    })
  })

  it('uses the request layer access token for the SSE request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        'data: {"type":"complete","done":true,"message":{"id":"m1","conversationId":"conversation-1","content":"answer"}}\n\ndata: [DONE]\n\n',
        {
        headers: { 'Content-Type': 'text/event-stream' },
        },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const events = []
    for await (const event of chatService.sendMessageStream(
      'conversation-1',
      'hello',
      'model-1',
      'relay-token-1',
    ))
      events.push(event)

    expect(events).toEqual([
      {
        type: 'complete',
        message: { id: 'm1', conversationId: 'conversation-1', content: 'answer' },
      },
    ])
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/v1/chat/conversations/conversation-1/messages',
      expect.objectContaining({
        headers: expect.any(Headers),
      }),
    )
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Headers).get('Authorization')).toBe('Bearer memory-access-token')
  })
})
