import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { logRequestMock, aiLogRequestMock, loggerMock } = vi.hoisted(() => ({
  logRequestMock: vi.fn(),
  aiLogRequestMock: vi.fn(),
  loggerMock: {
    debug: vi.fn(),
    error: vi.fn(),
    http: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("@/services/system/log.service", () => ({
  LogService: vi.fn(function LogServiceMock() {
    return {
      logRequest: logRequestMock,
    };
  }),
}));

vi.mock("@/services/relay/ai-request-log.service", () => ({
  AIRequestLogService: {
    getInstance: () => ({ logRequest: aiLogRequestMock }),
  },
}));

vi.mock("@/util/logger", () => ({
  LogCategory: { MIDDLEWARE: "MIDDLEWARE" },
  getLogger: () => loggerMock,
}));

import { loggingMiddleware } from "@/middleware/logging";
import { setAIRequestLogContext } from "@/util/ai-request-log-context";

function createTestApp() {
  const app = express();
  app.use(loggingMiddleware);

  app.get("/relay/proxy/test", (_req, res) => {
    res.status(500).json({ payload: "x".repeat(2 * 1024 * 1024) });
  });

  app.get("/relay/proxy/audited", (_req, res) => {
    setAIRequestLogContext(res, { requestId: "relay-audit-1", userId: "user-1" });
    res.status(200).json({ ok: true });
  });

  app.get("/normal/test", (_req, res) => {
    res.status(500).json({ ok: true });
  });

  app.get("/chunked/text", (_req, res) => {
    res.status(200);
    res.removeHeader("content-type");
    res.write('{"step":');
    res.end('"done"}');
  });

  app.get("/stream/writehead", (_req, res) => {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "x-upstream-request-id": "upstream-123",
      "set-cookie": ["session=secret"],
    });
    res.write("data: hello\n\n");
    res.end("data: [DONE]\n\n");
  });

  return app;
}

describe("loggingMiddleware response capture", () => {
  beforeEach(() => {
    logRequestMock.mockReset();
    logRequestMock.mockResolvedValue(undefined);
    aiLogRequestMock.mockReset();
    aiLogRequestMock.mockResolvedValue(undefined);
    Object.values(loggerMock).forEach((loggerMethod) => loggerMethod.mockReset());
  });

  it("captures relay proxy response bodies up to the AI audit limit", async () => {
    const app = createTestApp();

    await request(app).get("/relay/proxy/test").expect(500);

    expect(logRequestMock).toHaveBeenCalledTimes(1);
    const responseBody = logRequestMock.mock.calls[0][2];

    expect(responseBody).toMatchObject({
      _truncated: true,
      _contentType: expect.stringContaining("application/json"),
      _statusCode: 500,
      _closedEarly: false,
    });
    expect(responseBody._size).toBeGreaterThan(2 * 1024 * 1024);
    expect(responseBody._preview.length).toBeGreaterThan(1024 * 1024);
  });

  it("persists a dedicated AI audit log when relay context is present", async () => {
    const app = createTestApp();

    await request(app).get("/relay/proxy/audited").expect(200);

    expect(aiLogRequestMock).toHaveBeenCalledTimes(1);
    expect(aiLogRequestMock.mock.calls[0][2]).toEqual({ ok: true });
    expect(aiLogRequestMock.mock.calls[0][3]).toBeGreaterThanOrEqual(0);
  });

  it("still captures small non-relay response bodies", async () => {
    const app = createTestApp();

    await request(app).get("/normal/test").expect(500);

    expect(logRequestMock).toHaveBeenCalledTimes(1);
    expect(logRequestMock.mock.calls[0][2]).toEqual({ ok: true });
  });

  it("captures chunked utf8 text bodies even without an explicit text content-type", async () => {
    const app = createTestApp();

    await request(app).get("/chunked/text").expect(200);

    expect(logRequestMock).toHaveBeenCalledTimes(1);
    expect(logRequestMock.mock.calls[0][2]).toEqual({ step: "done" });
  });

  it("captures direct writeHead headers for later response-header logging", async () => {
    const app = createTestApp();
    const headerSnapshots: Array<Record<string, unknown> | null> = [];

    logRequestMock.mockImplementation(async (_req, res) => {
      headerSnapshots.push(JSON.parse(JSON.stringify((res as any).locals.responseHeadersSnapshot ?? null)));
    });

    await request(app).get("/stream/writehead").expect(200);

    expect(logRequestMock).toHaveBeenCalledTimes(1);
    expect(headerSnapshots[0]).toEqual({
      "content-type": "text/event-stream",
      "x-upstream-request-id": "upstream-123",
      "set-cookie": ["session=secret"],
    });
  });
});
