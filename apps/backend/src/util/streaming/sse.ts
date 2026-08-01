import type { Response } from "express";

export class SSEStreamService {
  private static instance: SSEStreamService;

  static getInstance() {
    if (!this.instance) this.instance = new SSEStreamService();
    return this.instance;
  }

  initStream(res: Response) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
  }

  sendChunk<T>(res: Response, data: T): void {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  sendDone(res: Response) {
    res.write("data: [DONE]\n\n");
  }

  sendError(res: Response, error: string): void {
    res.write(`data: ${JSON.stringify({ type: "error", error, done: true })}\n\n`);
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
