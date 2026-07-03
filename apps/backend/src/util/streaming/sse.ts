import type { Response } from "express";

export interface SSEChunk {
  [key: string]: any;
}

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

  sendChunk(res: Response, data: SSEChunk) {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  sendDone(res: Response) {
    res.write("data: [DONE]\n\n");
  }

  sendError(res: Response, error: string) {
    res.write(`data: ${JSON.stringify({ error })}\n\n`);
  }

  endStream(res: Response) {
    res.end();
  }

  async *handleStream<T>(generator: AsyncGenerator<T>, onChunk?: (chunk: T) => SSEChunk): AsyncGenerator<SSEChunk> {
    for await (const chunk of generator) yield onChunk ? onChunk(chunk) : (chunk as SSEChunk);
  }
}
