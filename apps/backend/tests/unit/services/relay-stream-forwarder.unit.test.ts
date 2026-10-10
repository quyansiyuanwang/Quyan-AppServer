import { env } from "@/config/env";
import http from "node:http";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RelayStreamForwarderService } from "@/services/relay/relay-stream-forwarder.service";
import { AI_RESOURCE_DEFAULTS } from "@/config/ai-resource-policy";
import { AIResourceConfigService } from "@/services/infrastructure/ai-resource-config.service";
const delta = Buffer.from('data: {"choices":[{"delta":{"content":"中文🙂"}}]}\n\n');
const usage = Buffer.from('data: {"u\\u0073age":{"prompt_tokens":12,"completion_tokens":3}}\n\n');
const done = Buffer.from("data: [DONE]\n\n");
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
afterEach(() => {
  vi.restoreAllMocks();
  AIResourceConfigService.getInstance().apply(structuredClone(AI_RESOURCE_DEFAULTS));
});
function fixture(
  options: {
    backpressure?: boolean;
    conversion?: boolean;
    responseTarget?: "anthropic" | "openai-responses";
    audit?: boolean;
    frameLimit?: number;
    gemini?: boolean;
    contentType?: string;
    contentLength?: number;
    bodyBuffer?: Buffer;
  } = {},
) {
  const upstream = Object.assign(new PassThrough(), {
    statusCode: 200,
    headers: {
      "content-type": options.contentType ?? "text/event-stream",
      ...(options.contentLength !== undefined ? { "content-length": String(options.contentLength) } : {}),
    },
  });
  const request = Object.assign(new EventEmitter(), {
    path: "/relay/proxy/v1/chat/completions",
    method: "POST",
    headers: {},
    ip: "127.0.0.1",
  });
  const output: Buffer[] = [];
  let blocked = options.backpressure ?? false;
  const response = Object.assign(new EventEmitter(), {
    headersSent: false,
    writableEnded: false,
    locals: {},
    writeHead: vi.fn(() => {
      response.headersSent = true;
    }),
    write: vi.fn((chunk: Buffer | string) => {
      output.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      if (blocked) {
        blocked = false;
        return false;
      }
      return true;
    }),
    end: vi.fn((chunk?: Buffer | string) => {
      if (chunk) output.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      response.writableEnded = true;
      response.emit("finish");
    }),
  });
  const proxyRequest = Object.assign(new EventEmitter(), { write: vi.fn(), end: vi.fn(), destroy: vi.fn() });
  vi.spyOn(http, "request").mockImplementation(((_opts: unknown, callback: (res: unknown) => void) => {
    proxyRequest.end.mockImplementation(() => queueMicrotask(() => callback(upstream)));
    return proxyRequest;
  }) as any);
  const evaluation = (text: string) => ({
    matched: false,
    text,
    action: "none",
    auditInputTokens: 0,
    auditOutputTokens: 0,
    auditCost: 0,
    auditDurationMs: 0,
  });
  const host = {
    contentSafetyService: {
      prepareAttempt: vi.fn(async () => ({ responseEnabled: true, responseAiEnabled: options.audit ?? false })),
      hasLocalResponseRules: vi.fn(async () => false),
      evaluate: vi.fn(async (_direction: string, text: string) => evaluation(text)),
      evaluateLocal: vi.fn(async (_direction: string, text: string) => evaluation(text)),
      recordIncident: vi.fn(),
    },
    relayProxyRepository: {},
    streamFrameLimitBytes: options.frameLimit,
    finalizeStreamUsage: vi.fn(async () => {}),
    calculateCost: vi.fn(() => ({ cost: 0, inputRate: 0, outputRate: 0 })),
    resolveContextMultiplier: () => ({ multiplier: 1, contextTokens: 0 }),
    getLogicalRequestId: () => "fixture",
    isPerRequestPricingConfig: () => false,
    removeAutoInjectedOpenAIStreamUsageOption: (body: unknown) => body,
    sendStreamTransportError: vi.fn(),
    shouldFailoverOnError: () => false,
    withRequestIdHeader: (_req: unknown, headers: unknown) => headers,
  };
  const params = {
    relayToken: { id: "t", userId: "u" },
    req: request,
    res: response,
    upstreamUrl: "http://fixture.invalid/v1/chat/completions",
    headers: {},
    selectedRateConfig: { input: 0, output: 0 },
    selectedModelName: "Stream channel pricing",
    selectedModelId: "m",
    globalMultiplier: 1,
    timeMultiplier: 1,
    convertedBody: { model: "m", stream: true },
    bodyBuffer: options.bodyBuffer ?? Buffer.from('{"model":"m","stream":true}'),
    requestFormat: options.gemini ? "gemini" : "openai-chat-completions",
    relayGlobalMultiplier: 1,
    channelMultiplier: 1,
    executionChannelId: "c",
    displayChannelId: "c",
    displayChannelName: "c",
    channelId: "c",
    monthlyPassCoverageAt: new Date(),
    upstreamStreamTimeout: 1000,
    responseTransform: options.conversion
      ? { sourceFormat: "openai-chat-completions", targetFormat: options.responseTarget ?? "anthropic" }
      : undefined,
  };
  return {
    upstream,
    request,
    proxyRequest,
    response,
    output,
    host,
    start: () => new RelayStreamForwarderService().forward(params as any, host as any),
  };
}
describe("relay single-chain stream forwarding", () => {
  it("rejects conversion retention overflow as 413 without starting success or billing", async () => {
    const settings = structuredClone(AI_RESOURCE_DEFAULTS);
    settings.aiResources.streaming.retainedLimitBytes = 8;
    AIResourceConfigService.getInstance().apply(settings);
    const f = fixture({ conversion: true, responseTarget: "openai-responses" });
    const pending = f.start();
    const rejected = expect(pending).rejects.toMatchObject({ statusCode: 413 });
    await tick();
    f.upstream.end(delta);
    await rejected;
    expect(f.response.headersSent).toBe(false);
    expect(f.response.end).not.toHaveBeenCalled();
    expect(f.host.finalizeStreamUsage).not.toHaveBeenCalled();
  });

  it("rejects an oversized wire request before opening upstream or starting a response", async () => {
    const f = fixture({ bodyBuffer: Buffer.alloc(env.runtime.requestSizeLimits.jsonBodyLimitMb * 1024 * 1024 + 1) });
    await expect(f.start()).rejects.toMatchObject({ statusCode: 413 });
    expect(http.request).not.toHaveBeenCalled();
    expect(f.response.writeHead).not.toHaveBeenCalled();
    expect(f.response.end).not.toHaveBeenCalled();
    expect(f.host.finalizeStreamUsage).not.toHaveBeenCalled();
  });
  it("rejects a known oversized reviewed response before sending 200 or reading its body", async () => {
    const f = fixture({ audit: true, contentLength: AI_RESOURCE_DEFAULTS.aiResources.streaming.outputLimitBytes + 1 });
    const pending = expect(f.start()).rejects.toMatchObject({ statusCode: 413 });
    await pending;
    expect(f.upstream.destroyed).toBe(true);
    expect(f.response.writeHead).not.toHaveBeenCalled();
    expect(f.response.end).not.toHaveBeenCalled();
    expect(f.host.finalizeStreamUsage).not.toHaveBeenCalled();
  });
  it.each([
    {},
    { conversion: true, responseTarget: "anthropic" as const },
    { conversion: true, responseTarget: "openai-responses" as const },
  ])("reports a late capacity failure without charging partial output (%s)", async (options) => {
    const f = fixture({ ...options, frameLimit: 128 });
    const pending = f.start();
    const rejected = expect(pending).rejects.toMatchObject({ statusCode: 413 });
    await tick();
    f.upstream.write(Buffer.concat([delta, usage]));
    await tick();
    expect(f.response.headersSent).toBe(true);
    f.upstream.end(Buffer.from('data: {"text":"' + "x".repeat(256) + '"}\n\n'));
    await rejected;
    const wire = Buffer.concat(f.output).toString();
    expect(wire).toContain(options.responseTarget === "openai-responses" ? "event: response.failed" : "event: error");
    expect(wire).not.toContain("message_stop");
    expect(wire).not.toContain("response.completed");
    expect(wire).toContain('"type":"request_too_large"');
    expect(wire).not.toContain("[DONE]");
    expect(f.host.finalizeStreamUsage).not.toHaveBeenCalled();
    expect(f.upstream.destroyed).toBe(true);
  });
  it("keeps partial-output settlement for an upstream transport failure, with an explicit error", async () => {
    const f = fixture();
    const pending = f.start();
    const rejected = expect(pending).rejects.toThrow("fixture disconnect");
    await tick();
    f.upstream.write(Buffer.concat([delta, usage]));
    await tick();
    f.upstream.destroy(new Error("fixture disconnect"));
    await rejected;
    expect(f.host.finalizeStreamUsage).toHaveBeenCalledOnce();
    expect(f.host.finalizeStreamUsage.mock.calls[0]).toEqual([
      expect.anything(),
      expect.objectContaining({ statusCode: 502 }),
    ]);
    expect(Buffer.concat(f.output).toString()).toContain("event: error");
    expect(Buffer.concat(f.output).toString()).not.toContain("[DONE]");
  });
  it("allows a long same-protocol stream beyond the retained-text budget", async () => {
    const settings = structuredClone(AI_RESOURCE_DEFAULTS);
    settings.aiResources.streaming.outputLimitBytes = 128;
    AIResourceConfigService.getInstance().apply(settings);
    const f = fixture({ frameLimit: 128 });
    const wire = Buffer.concat([Buffer.concat(Array(20).fill(delta)), usage, done]);
    const pending = f.start();
    await tick();
    f.upstream.end(wire);
    expect((await pending).success).toBe(true);
    expect(Buffer.concat(f.output)).toEqual(wire);
    expect(f.host.finalizeStreamUsage).toHaveBeenCalledOnce();
  });

  it.each(
    [false, true].flatMap((audit) =>
      ["text/event-stream", "application/x-ndjson"].flatMap((contentType) =>
        ["line", "sse"].map((dialect) => ({ audit, contentType, dialect })),
      ),
    ),
  )("records Gemini usage for $dialect framing ($contentType, audit=$audit)", async (options) => {
    // Some compatible upstreams advertise SSE while sending plain JSON lines.
    const events = [
      '{"candidates":[{"content":{"parts":[{"text":"中文🙂"}]}}]}',
      '{"candidates":[{"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":12,"candidatesTokenCount":3,"totalTokenCount":15}}',
    ];
    const wire = Buffer.from(
      events.map((event) => (options.dialect === "line" ? event + "\r\n" : "data: " + event + "\r\n\r\n")).join(""),
    );
    const f = fixture({ ...options, gemini: true });
    const parse = vi.spyOn(JSON, "parse");
    const pending = f.start();
    await tick();
    f.upstream.end(wire);
    expect((await pending).success).toBe(true);
    expect(parse).toHaveBeenCalledTimes(1);
    expect(f.host.finalizeStreamUsage).toHaveBeenCalledOnce();
    expect(f.host.finalizeStreamUsage.mock.calls[0]).toEqual([
      expect.anything(),
      expect.objectContaining({ requestTokens: 12, responseTokens: 3, totalTokens: 15 }),
    ]);
    expect(Buffer.concat(f.output)).toEqual(wire);
  });

  it("passes original UTF-8 bytes and parses only escaped usage events", async () => {
    const f = fixture();
    const parse = vi.spyOn(JSON, "parse");
    const pending = f.start();
    await tick();
    f.upstream.end(Buffer.concat([delta, usage, done]));
    expect((await pending).success).toBe(true);
    expect(Buffer.concat(f.output)).toEqual(Buffer.concat([delta, usage, done]));
    expect(parse).toHaveBeenCalledTimes(1);
    expect(f.host.finalizeStreamUsage).toHaveBeenCalledOnce();
    expect(f.host.finalizeStreamUsage.mock.calls[0]).toEqual([
      expect.anything(),
      expect.objectContaining({
        requestTokens: 12,
        responseTokens: 3,
        modelId: "m",
        modelName: "Stream channel pricing",
      }),
    ]);
    expect(f.proxyRequest.write).toHaveBeenCalledWith(Buffer.from('{"model":"m","stream":true}'));
    expect(f.request.listenerCount("aborted")).toBe(0);
    expect(f.response.listenerCount("close")).toBe(0);
  });
  it("shares parsed events between conversion and usage", async () => {
    const f = fixture({ conversion: true });
    const parse = vi.spyOn(JSON, "parse");
    const pending = f.start();
    await tick();
    f.upstream.end(Buffer.concat([delta, usage, done]));
    await pending;
    expect(parse).toHaveBeenCalledTimes(2);
    expect(Buffer.concat(f.output).toString()).toContain("message_stop");
  });
  it("reuses the whole-audit decoded text without duplicate usage parses during conversion", async () => {
    const f = fixture({ conversion: true, audit: true });
    const parse = vi.spyOn(JSON, "parse");
    const pending = f.start();
    await tick();
    f.upstream.end(Buffer.concat([delta, usage, done]));
    await pending;
    expect(parse).toHaveBeenCalledTimes(2);
    expect(f.host.contentSafetyService.evaluate).toHaveBeenCalledTimes(1);
  });
  it("does not process the next frame until the client drains", async () => {
    const f = fixture({ backpressure: true });
    const pending = f.start();
    await tick();
    f.upstream.end(Buffer.concat([delta, usage, done]));
    await tick();
    expect(f.output).toHaveLength(1);
    expect(f.upstream.isPaused()).toBe(true);
    f.response.emit("drain");
    await pending;
    expect(f.output).toHaveLength(3);
    expect(f.response.listenerCount("drain")).toBe(0);
  });
  it("cancels oversized frames and never reports a successful completion", async () => {
    const f = fixture({ conversion: true, frameLimit: 8 });
    const pending = f.start();
    const result = expect(pending).rejects.toThrow("resource budget");
    await tick();
    f.upstream.end(delta);
    await result;
    expect(f.upstream.destroyed).toBe(true);
    expect(f.output).toHaveLength(0);
    expect(f.response.end).not.toHaveBeenCalled();
    expect(f.response.writeHead).not.toHaveBeenCalled();
    expect(f.host.finalizeStreamUsage).not.toHaveBeenCalled();
    expect(f.request.listenerCount("aborted")).toBe(0);
  });
});
