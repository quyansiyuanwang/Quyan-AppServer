import { describe, expect, it, vi } from "vitest";
import { SSEStreamService } from "@/util/streaming/sse";

describe("SSEStreamService", () => {
  const createResponse = () => {
    return {
      setHeader: vi.fn(),
      flushHeaders: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
    } as any;
  };

  it("returns singleton instance", () => {
    const a = SSEStreamService.getInstance();
    const b = SSEStreamService.getInstance();

    expect(a).toBe(b);
  });

  it("initializes SSE headers", () => {
    const service = SSEStreamService.getInstance();
    const res = createResponse();

    service.initStream(res);

    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "text/event-stream");
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-cache");
    expect(res.setHeader).toHaveBeenCalledWith("Connection", "keep-alive");
    expect(res.flushHeaders).toHaveBeenCalledTimes(1);
  });

  it("writes data, done and error chunks", () => {
    const service = SSEStreamService.getInstance();
    const res = createResponse();

    service.sendChunk(res, { a: 1 });
    service.sendDone(res);
    service.sendError(res, "boom");
    service.endStream(res);

    expect(res.write).toHaveBeenNthCalledWith(1, 'data: {"a":1}\n\n');
    expect(res.write).toHaveBeenNthCalledWith(2, "data: [DONE]\n\n");
    expect(res.write).toHaveBeenNthCalledWith(3, 'data: {"error":"boom"}\n\n');
    expect(res.end).toHaveBeenCalledTimes(1);
  });

  it("transforms chunks with onChunk callback", async () => {
    const service = SSEStreamService.getInstance();

    async function* source() {
      yield { token: 1 };
      yield { token: 2 };
    }

    const result: Array<Record<string, unknown>> = [];
    for await (const chunk of service.handleStream(source(), (item) => ({ value: item.token * 10 })))
      result.push(chunk);

    expect(result).toEqual([{ value: 10 }, { value: 20 }]);
  });

  it("yields original chunks when onChunk is omitted", async () => {
    const service = SSEStreamService.getInstance();

    async function* source() {
      yield { msg: "x" };
      yield { msg: "y" };
    }

    const result: Array<Record<string, unknown>> = [];
    for await (const chunk of service.handleStream(source())) result.push(chunk);

    expect(result).toEqual([{ msg: "x" }, { msg: "y" }]);
  });
});
