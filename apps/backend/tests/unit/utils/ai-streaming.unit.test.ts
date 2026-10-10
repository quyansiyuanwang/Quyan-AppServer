import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { BoundedTextLines, boundedTextLines } from "@/util/streaming/bounded-text";
import { readRelayStreamBodyLimited } from "@/services/relay/utils/relay-upstream-response.util";
import { writeWithBackpressure } from "@/util/streaming/backpressure";

describe("bounded AI streaming", () => {
  it("preserves split UTF-8 and permits many bounded lines in one large chunk", () => {
    const parser = new BoundedTextLines(8);
    const bytes = Buffer.from("你好\n");
    expect(parser.feed(bytes.subarray(0, 2))).toEqual([]);
    expect(parser.feed(bytes.subarray(2))).toEqual(["你好"]);
    expect(parser.feed(Buffer.from("small\n".repeat(100)))).toHaveLength(100);
    expect(() => parser.feed("123456789")).toThrow("resource budget");
  });
  it("stops reading oversized frames and buffered responses immediately", async () => {
    let readBeyondLimit = false;
    const destroy = vi.fn();
    const stream = () => ({
      destroy,
      async *[Symbol.asyncIterator]() {
        yield Buffer.from("oversized frame");
        readBeyondLimit = true;
        yield Buffer.from("must not read");
      },
    });
    await expect(
      (async () => {
        for await (const line of boundedTextLines(stream(), 8)) {
          void line;
        }
      })(),
    ).rejects.toMatchObject({ statusCode: 413 });
    expect(destroy).toHaveBeenCalledOnce();
    expect(readBeyondLimit).toBe(false);
    const buffered = await readRelayStreamBodyLimited(stream(), 8);
    expect(buffered.truncated).toBe(true);
    expect(buffered.buffer.length).toBe(8);
    expect(readBeyondLimit).toBe(false);
  });

  it("destroys the upstream when a consumer ends early", async () => {
    const stream = {
      destroy: vi.fn(),
      async *[Symbol.asyncIterator]() {
        yield Buffer.from("first\nsecond\n");
      },
    };
    for await (const line of boundedTextLines(stream, 8)) {
      expect(line).toBe("first");
      break;
    }
    expect(stream.destroy).toHaveBeenCalledOnce();
  });
  it("waits for drain and removes every listener afterwards", async () => {
    const response = Object.assign(new EventEmitter(), { write: vi.fn(() => false) });
    let done = false;
    const writing = writeWithBackpressure(response, "data").then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(false);
    response.emit("drain");
    await writing;
    expect(response.eventNames()).toEqual([]);
  });
  it("interrupts a stalled write on disconnect or abort", async () => {
    const response = Object.assign(new EventEmitter(), { write: vi.fn(() => false) });
    const controller = new AbortController();
    const writing = expect(writeWithBackpressure(response, "data", controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    controller.abort();
    await writing;
    expect(response.eventNames()).toEqual([]);
  });
});
