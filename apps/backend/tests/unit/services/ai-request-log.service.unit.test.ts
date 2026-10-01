import { beforeEach, describe, expect, it, vi } from "vitest";
import { AIRequestLogService } from "@/services/relay/ai-request-log.service";
import { setAIRequestLogContext } from "@/util/ai-request-log-context";

describe("AIRequestLogService", () => {
  const repository = {
    create: vi.fn(),
    query: vi.fn(),
    findById: vi.fn(),
    updateByRequestId: vi.fn(),
    findMetadata: vi.fn(),
    findPayload: vi.fn(),
    findAttempts: vi.fn(),
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
    repository.updateByRequestId.mockResolvedValue(undefined);
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
  it("omits untrusted bodies and ignores client-provided user IDs", async () => {
    const service = new ServiceCtor(repository);
    const req = createRequest({ metadata: { user_id: "impersonated" }, prompt: "private attacker body" });
    const res = createResponse();
    res.statusCode = 401;
    setAIRequestLogContext(res, {
      requestId: "early-1",
      authenticationState: "unknown",
      failureStage: "authentication",
    });
    await service.logRequest(req, res, { error: "unsafe" });
    expect(repository.create.mock.calls[0][0]).toMatchObject({
      outcome: "failed",
      bodyOmissionReason: "unknown-identity",
    });
    expect(repository.create.mock.calls[0][0]).not.toHaveProperty("requestBody");
    expect(repository.create.mock.calls[0][0]).not.toHaveProperty("responseBody");
  });
  it("records malformed and oversized request metadata without unsafe previews", async () => {
    const service = new ServiceCtor(repository);
    const req = createRequest(Buffer.from('{"token":"secret"'));
    req.headers["content-type"] = "application/json";
    const res = createResponse();
    res.statusCode = 400;
    setAIRequestLogContext(res, { requestId: "bad-json", userId: "user-1" });
    await service.logRequest(req, res, "unsafe");
    expect(repository.create.mock.calls[0][0]).toMatchObject({ bodyOmissionReason: "invalid-body" });
    expect(repository.create.mock.calls[0][0]).not.toHaveProperty("requestBody");
  });
  it("creates once and serializes failure updates that race initial insertion", async () => {
    let finish: () => void = () => {};
    repository.create.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const service = new ServiceCtor(repository);
    const req = createRequest({ prompt: "hello" });
    const res = createResponse();
    setAIRequestLogContext(res, {
      requestId: "late-failure",
      userId: "user-1",
      executionPending: true,
      outcome: "pending",
    });
    const writing = service.logRequest(req, res, "partial");
    await Promise.resolve();
    setAIRequestLogContext(res, {
      outcome: "failed",
      failureStage: "settlement",
      errorSummary: "Settlement failed",
      executionPending: false,
    });
    expect(repository.updateByRequestId).not.toHaveBeenCalled();
    finish();
    await writing;
    await service.logRequest(req, res);
    expect(repository.create).toHaveBeenCalledTimes(1);
    expect(repository.updateByRequestId).toHaveBeenLastCalledWith(
      "late-failure",
      expect.objectContaining({ outcome: "failed", failureStage: "settlement" }),
    );
    setAIRequestLogContext(res, { outcome: "success" });
    await service.logRequest(req, res);
    expect(repository.updateByRequestId).toHaveBeenLastCalledWith(
      "late-failure",
      expect.objectContaining({ outcome: "failed" }),
    );
  });
  it("does not turn an HTTP 200 closed stream into a successful request", async () => {
    const service = new ServiceCtor(repository);
    const req = createRequest({ stream: true });
    const res = createResponse();
    res.locals.responseClosedEarly = true;
    setAIRequestLogContext(res, { requestId: "closed-stream", userId: "user-1", outcome: "success" });
    await service.logRequest(req, res, "partial");
    expect(repository.create.mock.calls[0][0]).toMatchObject({ statusCode: 200, outcome: "interrupted" });
  });
  it("preserves captured wire size rather than the preview wrapper size and bounds identifiers", async () => {
    const service = new ServiceCtor(repository);
    const req = createRequest({ model: "m".repeat(200) });
    const res = createResponse();
    res.locals.responseCaptureState = { totalBytes: 5 * 1024 * 1024 };
    setAIRequestLogContext(res, {
      requestId: "wire-size",
      userId: "user-1",
      model: "m".repeat(200),
      relayTokenName: "t".repeat(150),
    });
    await service.logRequest(req, res, { _truncated: true, _preview: "saved partial response" });
    const input = repository.create.mock.calls[0][0];
    expect(input.responseSizeBytes).toBe(5 * 1024 * 1024);
    expect(input.responseTruncated).toBe(true);
    expect(input.model).toHaveLength(160);
    expect(input.relayTokenName).toHaveLength(100);
  });

  it("adds late recognized identity without restoring an omitted body", async () => {
    const service = new ServiceCtor(repository);
    const req = createRequest({ metadata: { user_id: "spoof" } });
    const res = createResponse();
    res.locals.responseClosedEarly = true;
    setAIRequestLogContext(res, { requestId: "slow-auth", authenticationState: "unknown" });
    await service.logRequest(req, res);
    setAIRequestLogContext(res, {
      userId: "real-user",
      username: "real-name",
      relayTokenId: "real-token",
      authenticationState: "rejected",
    });
    await service.logRequest(req, res);
    expect(repository.updateByRequestId).toHaveBeenLastCalledWith(
      "slow-auth",
      expect.objectContaining({ userId: "real-user", username: "real-name", relayTokenId: "real-token" }),
    );
    expect(repository.updateByRequestId.mock.calls[0][1]).not.toHaveProperty("requestBody");
  });

  it("metadata never reads or returns request/response bodies", async () => {
    repository.findMetadata.mockResolvedValue({
      id: "meta",
      hasRequestBody: true,
      hasResponseBody: false,
      requestTruncated: false,
      responseTruncated: false,
    });
    const service = new ServiceCtor(repository);
    const result = await service.metadata("meta");
    expect(result.availableSides).toEqual(["request"]);
    expect(result).not.toHaveProperty("requestBody");
    expect(repository.findById).not.toHaveBeenCalled();
  });
});
