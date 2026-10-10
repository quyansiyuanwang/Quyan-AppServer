import { writeWithBackpressure } from "./backpressure";
import type { Response } from "express";

export class SSEStreamService {
  private static instance: SSEStreamService;

  static getInstance() {
    if (!this.instance) this.instance = new SSEStreamService();
    return this.instance;
  }

  initStream(res: Response) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    // Nginx honors this response header even when an older deployment does not
    // yet contain a dedicated `proxy_buffering off` location for the SSE route.
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
  }

  sendChunk<T>(res: Response, data: T): Promise<void> {
    return writeWithBackpressure(res, `data: ${JSON.stringify(data)}\n\n`);
  }

  sendDone(res: Response) {
    return writeWithBackpressure(res, "data: [DONE]\n\n");
  }

  sendError(res: Response, error: string): Promise<void> {
    return writeWithBackpressure(res, `data: ${JSON.stringify({ type: "error", error, done: true })}\n\n`);
  }

  endStream(res: Response) {
    res.end();
  }

  handleStream<T>(generator: AsyncGenerator<T>): AsyncGenerator<T>;
  handleStream<T, TEvent>(generator: AsyncGenerator<T>, onChunk: (chunk: T) => TEvent): AsyncGenerator<TEvent>;
  async *handleStream<T, TEvent>(
    generator: AsyncGenerator<T>,
    onChunk?: (chunk: T) => TEvent,
  ): AsyncGenerator<T | TEvent> {
    for await (const chunk of generator) yield onChunk ? onChunk(chunk) : chunk;
  }
}
