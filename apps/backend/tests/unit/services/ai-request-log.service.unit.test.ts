import { beforeEach, describe, expect, it, vi } from "vitest";
import { AIRequestLogService } from "@/services/relay/ai-request-log.service";
import { setAIRequestLogContext } from "@/util/ai-request-log-context";

describe("AIRequestLogService", () => {
  const repository = {
    create: vi.fn(),
    query: vi.fn(),
    findById: vi.fn(),
  };
  const ServiceCtor = AIRequestLogService as unknown as new (repo: any) => AIRequestLogService;

  const createRequest = (body: unknown) =>
    ({
      headers: { "x-request-id": "site-request-1", "user-agent": "vitest" },
      body,
      method: "POST",
      originalUrl: "/relay/proxy/v1/chat/completions",
      ip: "127.0.0.1",
      socket: { remoteAddress: "127.0.0.1" },
    }) as any;

  const createResponse = () =>
    ({
      statusCode: 200,
      locals: {},
    }) as any;

  beforeEach(() => {
    vi.clearAllMocks();
    repository.create.mockResolvedValue({ id: "log-1" });
  });

  it("stores the original request shape while masking sensitive keys", async () => {
    const service = new ServiceCtor(repository);
    const req = createRequest({
      model: "test-model",
      messages: [{ role: "user", content: "violating content" }],
      max_tokens: 100,
      authorization: "Bearer secret",
      api_key: "secret",
    });
    const res = createResponse();
    setAIRequestLogContext(res, {
      requestId: "relay-request-1",
      userId: "user-1",
      username: "alice",
      relayTokenId: "token-1",
      relayTokenName: "main",
      model: "test-model",
      requestFormat: "openai-chat-completions",
    });

    await service.logRequest(req, res, { choices: [{ message: { content: "answer" } }] }, 125);

    const input = repository.create.mock.calls[0][0];
    expect(input).toMatchObject({
      requestId: "relay-request-1",
      userId: "user-1",
      relayTokenId: "token-1",
      statusCode: 200,
      durationMs: 125,
      requestTruncated: false,
      responseTruncated: false,
    });
    expect(input.requestBody).toMatchObject({
      model: "test-model",
      messages: [{ role: "user", content: "violating content" }],
      max_tokens: 100,
      authorization: "***FILTERED***",
      api_key: "***FILTERED***",
    });
    expect(input).not.toHaveProperty("requestHeaders");
  });

  it("marks oversized request and response content as truncated with previews", async () => {
    const service = new ServiceCtor(repository);
    const req = createRequest({ prompt: "x".repeat(1_100_000) });
    const res = createResponse();
    setAIRequestLogContext(res, { requestId: "relay-request-2", userId: "user-1" });

    await service.logRequest(req, res, { text: "y".repeat(2_100_000) }, 10);

    const input = repository.create.mock.calls[0][0];
    expect(input.requestTruncated).toBe(true);
    expect(input.responseTruncated).toBe(true);
    expect(input.requestBody).toMatchObject({ _truncated: true });
    expect(input.responseBody).toMatchObject({ _truncated: true });
  });

  it("replaces image and binary content with metadata placeholders", async () => {
    const service = new ServiceCtor(repository);
    const req = createRequest({
      prompt: "draw this",
      image: "data:image/png;base64,AAAA",
      source: { type: "base64", data: "AAAA" },
    });
    const res = createResponse();
    setAIRequestLogContext(res, { requestId: "relay-request-3", userId: "user-1" });

    await service.logRequest(req, res, Buffer.from([1, 2, 3]), 5);

    const input = repository.create.mock.calls[0][0];
    expect(input.requestBody.prompt).toBe("draw this");
    expect(input.requestBody.image).toMatchObject({ _binary: true, _contentType: "image" });
    expect(input.requestBody.source).toMatchObject({ _binary: true, _contentType: "image" });
    expect(input.responseBody).toMatchObject({ _binary: true, _size: 3 });
  });

  it("does not throw when a duplicate request id is ignored by the repository", async () => {
    repository.create.mockResolvedValue(null);
    const service = new ServiceCtor(repository);
    const req = createRequest({ prompt: "hello" });
    const res = createResponse();
    setAIRequestLogContext(res, { requestId: "relay-request-duplicate", userId: "user-1" });

    await expect(service.logRequest(req, res, "ok", 1)).resolves.toBeUndefined();
  });
});
