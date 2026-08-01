/**
 * Composes authentication, signing, tenant routing, or other request concerns
 * without coupling an SSE consumer to a particular upstream service.
 */
/** A transport-agnostic request definition for a server-sent events connection. */
export interface SseRequest<TInit = unknown> {
  url: string
  init: TInit
}

export type SseRequestMiddleware<TContext = unknown, TInit = unknown> = (
  request: SseRequest<TInit>,
  context: TContext | undefined,
) => SseRequest<TInit> | Promise<SseRequest<TInit>>

export async function applySseRequestMiddlewares<TContext, TInit>(
  request: SseRequest<TInit>,
  context: TContext | undefined,
  middlewares: readonly SseRequestMiddleware<TContext, TInit>[],
): Promise<SseRequest<TInit>> {
  let nextRequest = request
  for (const middleware of middlewares) {
    nextRequest = await middleware(nextRequest, context)
    if (!nextRequest || typeof nextRequest.url !== 'string' || !nextRequest.init)
      throw new TypeError('SSE request middleware returned an invalid request')
  }
  return nextRequest
}
