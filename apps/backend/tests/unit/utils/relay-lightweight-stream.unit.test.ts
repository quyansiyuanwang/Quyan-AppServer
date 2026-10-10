import { describe, expect, it, vi } from "vitest";
import { BoundedByteFrames } from "@/util/streaming/bounded-byte-frames";
import { consumeRelayStreamUsageLine, RelayStreamUsageTracker } from "@/util/relay/relay-stream-usage.util";
import { parseRelayStreamEvent, relayDecodedFrames } from "@/util/relay/relay-stream-usage.util";
import { jsonSerializedLength } from "@/util/json-serialized-length";
import { parseRelayRequestBody, relayRawRequestBody } from "@/util/relay/relay-request-payload";
describe("lightweight forwarding", () => {
  it.each(["line", "sse"])("detects Gemini %s framing across byte/UTF-8 seams", (dialect) => {
    const text =
      dialect === "line"
        ? ' \t{"text":"中文🙂","usageMetadata":{"promptTokenCount":4}}\r\n{"usageMetadata":{"promptTokenCount":5}}\r\n'
        : 'event: message\r\ndata: {"text":"中文🙂","usageMetadata":\r\ndata: {"promptTokenCount":4}}\r\n\r\ndata: {"usageMetadata":{"promptTokenCount":5}}\r\n\r\n';
    const parser = new BoundedByteFrames(128, "gemini");
    const frames: Buffer[] = [];
    for (const byte of Buffer.from(text)) frames.push(...parser.feed(Buffer.from([byte])));
    expect(parser.finish()).toBeUndefined();
    expect(parser.retainedBytes).toBe(0);
    expect(frames).toHaveLength(2);
    expect(Buffer.concat(frames).toString()).toBe(text);
    expect(Array.from(relayDecodedFrames(text, "gemini"))).toEqual(frames.map((frame) => frame.toString()));
    expect(
      frames.map((frame) => parseRelayStreamEvent(frame.toString(), "gemini").usageMetadata.promptTokenCount),
    ).toEqual([4, 5]);
  });
  it("applies Gemini frame capacity per JSON line even when a chunk contains many events", () => {
    const line = Buffer.from('{"usageMetadata":{"candidatesTokenCount":3}}\n');
    const parser = new BoundedByteFrames(line.length, "gemini");
    const wire = Buffer.concat([line, line, line]);
    const frames = Array.from(parser.feed(wire));
    expect(frames).toHaveLength(3);
    expect(Buffer.concat(frames)).toEqual(wire);
    expect(parser.retainedBytes).toBe(0);
    expect(() => Array.from(parser.feed(Buffer.from('{"oversized":"' + "x".repeat(line.length))))).toThrow();
    expect(parser.retainedBytes).toBe(0);
  });

  it("frames multiple events without a chunk-level overflow and handles CRLF/UTF-8 seams", () => {
    const parser = new BoundedByteFrames(32);
    const body = Buffer.from("data: 中文🙂\r\n\r\ndata: 2\n\n");
    const frames: Buffer[] = [];
    for (const byte of body) frames.push(...parser.feed(Buffer.from([byte])));
    expect(Buffer.concat(frames)).toEqual(body);
    expect(parser.retainedBytes).toBe(0);
  });
  it("rejects a single oversized pending frame and releases owned slices", () => {
    const parser = new BoundedByteFrames(8);
    expect(() => Array.from(parser.feed(Buffer.from("data:1234")))).toThrow();
    expect(parser.retainedBytes).toBe(0);
  });
  it("does not JSON parse ordinary delta events, but reads escaped usage names", () => {
    const tracker = new RelayStreamUsageTracker(10, true);
    const parse = vi.spyOn(JSON, "parse");
    consumeRelayStreamUsageLine(
      'data: {"choices":[{"delta":{"content":"hello"}}]}',
      "openai-chat-completions",
      tracker,
    );
    expect(parse).not.toHaveBeenCalled();
    consumeRelayStreamUsageLine(
      String.raw`data: {"u\u0073age":{"prompt_tokens":12,"completion_tokens":3}}`,
      "openai-chat-completions",
      tracker,
    );
    expect(tracker.requestTokens).toBe(12);
    expect(tracker.responseTokens).toBe(3);
    parse.mockRestore();
  });
  it("preserves the original buffer and parses a relay request only once", () => {
    const raw = Buffer.from('{ "model":"m", "stream":true }');
    const request = { body: raw, headers: { "content-type": "application/json" } };
    const parse = vi.spyOn(JSON, "parse");
    parseRelayRequestBody(request);
    parseRelayRequestBody(request);
    expect(parse).toHaveBeenCalledTimes(1);
    expect(relayRawRequestBody(request)).toBe(raw);
    parse.mockRestore();
  });
  it("counts the exact canonical JSON UTF-16 length without serializing", () => {
    for (const input of [
      { a: '中文🙂\n"\\', b: [undefined, NaN, true, null] },
      "\ud800",
      ["a", "b"],
      { empty: {}, omitted: undefined },
    ])
      expect(jsonSerializedLength(input)).toBe(JSON.stringify(input).length);
  });
  it("frames plain Gemini JSON lines and reuses decoded frames for conversion and usage", () => {
    const parser = new BoundedByteFrames(128, "line");
    const text = '{"usageMetadata":{"promptTokenCount":4}}\n{"usageMetadata":{"promptTokenCount":5}}\n';
    expect(Array.from(parser.feed(Buffer.from(text)))).toHaveLength(2);
    const parse = vi.spyOn(JSON, "parse");
    const values = Array.from(relayDecodedFrames(text, "line"), (frame) => parseRelayStreamEvent(frame, "gemini"));
    expect(values.map((value) => value.usageMetadata.promptTokenCount)).toEqual([4, 5]);
    expect(parse).toHaveBeenCalledTimes(2);
    parse.mockRestore();
  });
});
