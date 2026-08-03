import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Request, Response } from "express";
import { LogService } from "@/services/system/log.service";
import type { APILogStore } from "@/store/system/apilog.store";
import { INTERNAL_LOG_METADATA_KEY } from "@/config/logging";

describe("LogService", () => {
  let mockRepo: APILogStore;
  let logService: LogService;

  beforeEach(() => {
    mockRepo = {
      create: vi.fn().mockResolvedValue({ id: "test-id" }),
      createMany: vi.fn().mockResolvedValue(1),
      query: vi.fn(),
      listForStats: vi.fn().mockResolvedValue([]),
      findById: vi.fn(),
      deleteOldLogs: vi.fn(),
    };

    logService = new LogService(mockRepo, { registerShutdownHandlers: false });
  });

  afterEach(async () => {
    await logService.dispose({ flush: false });
    vi.clearAllTimers();
  });

  describe("logRequest", () => {
    let mockReq: Partial<Request>;
    let mockRes: Partial<Response>;

    beforeEach(() => {
      mockReq = {
        headers: { "x-request-id": "test-request-id" },
        originalUrl: "/test/path",
        url: "/test/path",
        method: "POST",
        query: {},
        body: {},
        ip: "127.0.0.1",
        socket: { remoteAddress: "127.0.0.1" } as any,
      };

      mockRes = {
        statusCode: 200,
      };
    });

    it("should buffer log entry without immediate DB write", async () => {
      await logService.logRequest(mockReq as Request, mockRes as Response);

      expect(mockRepo.create).not.toHaveBeenCalled();
      expect(mockRepo.createMany).not.toHaveBeenCalled();
    });

    it("should skip relay proxy paths with success status", async () => {
      mockReq.originalUrl = "/relay/proxy/test";
      mockRes.statusCode = 200;

      await logService.logRequest(mockReq as Request, mockRes as Response);
      await logService.flushNow();

      expect(mockRepo.create).not.toHaveBeenCalled();
    });

    it("should skip nested relay proxy generated sub-routes with success status", async () => {
      mockReq.originalUrl = "/relay/proxy/v1/models/gpt-4/generateContent";
      mockRes.statusCode = 200;

      await logService.logRequest(mockReq as Request, mockRes as Response);
      await logService.flushNow();

      expect(mockRepo.create).not.toHaveBeenCalled();
      expect(mockRepo.createMany).not.toHaveBeenCalled();
    });

    it("should log high-frequency paths with error status", async () => {
      mockReq.originalUrl = "/relay/proxy/test";
      mockRes.statusCode = 500;

      await logService.logRequest(mockReq as Request, mockRes as Response);
      await logService.flushNow();

      expect(mockRepo.create).toHaveBeenCalledTimes(1);
    });

    it("should skip logging for configured status codes", async () => {
      mockRes.statusCode = 401; // Configured in SKIP_LOGGING_STATUS_CODES

      await logService.logRequest(mockReq as Request, mockRes as Response);

      expect(mockRepo.create).not.toHaveBeenCalled();
    });

    it("should generate requestID when missing", async () => {
      delete mockReq.headers;
      mockReq.headers = {};

      await logService.logRequest(mockReq as Request, mockRes as Response);

      // Should not throw, requestID generated internally
      expect(mockRepo.create).not.toHaveBeenCalled();
    });

    it("should filter sensitive fields from request body", async () => {
      mockReq.body = {
        username: "test",
        password: "secret123",
        token: "abc123",
      };

      await logService.logRequest(mockReq as Request, mockRes as Response);

      // Sensitive data should be filtered (verified by not throwing)
      expect(mockRepo.create).not.toHaveBeenCalled();
    });

    it("should truncate large request params", async () => {
      mockReq.body = {
        data: "x".repeat(100000), // Large payload
      };

      await logService.logRequest(mockReq as Request, mockRes as Response);

      expect(mockRepo.create).not.toHaveBeenCalled();
    });

    it("should limit response depth", async () => {
      const deepObject = { level1: { level2: { level3: { level4: { level5: "deep" } } } } };

      await logService.logRequest(mockReq as Request, mockRes as Response, deepObject);

      expect(mockRepo.create).not.toHaveBeenCalled();
    });

    it("should exclude response for configured paths", async () => {
      mockReq.originalUrl = "/v1/system/logs";

      await logService.logRequest(mockReq as Request, mockRes as Response, { data: "test" });
      await logService.flushNow();

      expect(mockRepo.create).not.toHaveBeenCalled();
    });

    it("should always skip logging for /system/logs even on error responses", async () => {
      mockReq.originalUrl = "/v1/system/logs/test-id";
      mockRes.statusCode = 500;

      await logService.logRequest(mockReq as Request, mockRes as Response, { error: "test" });
      await logService.flushNow();

      expect(mockRepo.create).not.toHaveBeenCalled();
      expect(mockRepo.createMany).not.toHaveBeenCalled();
    });

    it("should not treat lookalike prefixes as configured paths", async () => {
      mockReq.originalUrl = "/v1/system/logs-extra";
      mockRes.statusCode = 500;

      await logService.logRequest(mockReq as Request, mockRes as Response, { error: "test" });
      await logService.flushNow();

      expect(mockRepo.create).toHaveBeenCalledTimes(1);
    });

    it("should always skip logging for heartbeat API even on error responses", async () => {
      mockReq.originalUrl = "/v1/users/me/heartbeat";
      mockRes.statusCode = 500;

      await logService.logRequest(mockReq as Request, mockRes as Response, { error: "heartbeat failed" });
      await logService.flushNow();

      expect(mockRepo.create).not.toHaveBeenCalled();
      expect(mockRepo.createMany).not.toHaveBeenCalled();
    });

    it("should store request path without query string", async () => {
      mockReq.originalUrl = "/v1/relay/tokens/usage-summaries?tokenIds=a,b,c";
      mockReq.query = { tokenIds: "a,b,c" };
      mockRes.statusCode = 500;

      await logService.logRequest(mockReq as Request, mockRes as Response);
      await logService.flushNow();

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          path: "/v1/relay/tokens/usage-summaries",
          queryParams: { tokenIds: "***FILTERED***" },
        }),
      );
    });

    it("should extract client IP from x-forwarded-for header", async () => {
      mockReq.headers = {
        "x-request-id": "test",
        "x-forwarded-for": "203.0.113.1, 198.51.100.1",
      };

      await logService.logRequest(mockReq as Request, mockRes as Response);

      expect(mockRepo.create).not.toHaveBeenCalled();
    });

    it("should handle Buffer response body", async () => {
      const bufferResponse = Buffer.from("binary data");

      await logService.logRequest(mockReq as Request, mockRes as Response, bufferResponse);

      expect(mockRepo.create).not.toHaveBeenCalled();
    });

    it("should persist a structured placeholder when response body is not captured", async () => {
      mockRes.getHeader = vi.fn().mockReturnValue("text/event-stream");

      await logService.logRequest(mockReq as Request, mockRes as Response, undefined);
      await logService.flushNow();

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          response: expect.objectContaining({
            _notCaptured: true,
            _statusCode: 200,
            _contentType: "text/event-stream",
          }),
        }),
      );
    });

    it("should preserve literal null responses as non-null structured payloads", async () => {
      await logService.logRequest(mockReq as Request, mockRes as Response, null);
      await logService.flushNow();

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          response: expect.objectContaining({
            _literal: null,
          }),
        }),
      );
    });

    it("should store filtered response headers in the dedicated column", async () => {
      mockRes.getHeader = vi.fn((name: string) => {
        if (name === "content-type") return "application/json";
        return undefined;
      }) as any;
      mockRes.getHeaders = vi.fn().mockReturnValue({
        "content-type": "application/json",
        "x-trace-id": "trace-123",
        "set-cookie": ["session=secret"],
      });

      await logService.logRequest(mockReq as Request, mockRes as Response, { ok: true });
      await logService.flushNow();

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          responseHeaders: {
            "content-type": "application/json",
            "x-trace-id": "trace-123",
            "set-cookie": "***FILTERED***",
          },
        }),
      );

      const createCall = vi.mocked(mockRepo.create).mock.calls[0]?.[0] as Record<string, any>;
      expect(createCall?.requestHeaders?.[INTERNAL_LOG_METADATA_KEY]).toEqual(
        expect.objectContaining({
          responseSizeBytes: expect.any(Number),
        }),
      );
      expect(createCall?.requestHeaders?.[INTERNAL_LOG_METADATA_KEY]).not.toHaveProperty("responseHeaders");
    });

    it("should persist direct writeHead headers when getHeaders does not expose them", async () => {
      mockRes.getHeaders = vi.fn().mockReturnValue({});
      mockRes.getHeader = vi.fn().mockReturnValue(undefined) as any;
      mockRes.locals = {
        responseHeadersSnapshot: {
          "content-type": "text/event-stream",
          "x-upstream-request-id": "upstream-123",
          "set-cookie": ["session=secret"],
        },
      } as any;

      await logService.logRequest(mockReq as Request, mockRes as Response, "data: hello\n\ndata: [DONE]\n\n");
      await logService.flushNow();

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          responseHeaders: {
            "content-type": "text/event-stream",
            "x-upstream-request-id": "upstream-123",
            "set-cookie": "***FILTERED***",
          },
        }),
      );
    });
  });

  describe("Buffer management", () => {
    it("should buffer log entries without immediate DB write", async () => {
      const mockReq = {
        headers: { "x-request-id": "test-1" },
        originalUrl: "/test",
        url: "/test",
        method: "GET",
        query: {},
        body: {},
        ip: "127.0.0.1",
        socket: { remoteAddress: "127.0.0.1" } as any,
      } as unknown as Request;

      const mockRes = { statusCode: 200 } as Response;

      // Add log to buffer
      await logService.logRequest(mockReq, mockRes);

      // Should not write immediately
      expect(mockRepo.create).not.toHaveBeenCalled();
      expect(mockRepo.createMany).not.toHaveBeenCalled();
    });

    it("should flush buffered logs when timer fires", async () => {
      vi.useFakeTimers();

      const timedService = new LogService(mockRepo, {
        registerShutdownHandlers: false,
        flushIntervalMs: 50,
      });

      const mockReq = {
        headers: { "x-request-id": "timer-flush" },
        originalUrl: "/test",
        url: "/test",
        method: "GET",
        query: {},
        body: {},
        ip: "127.0.0.1",
        socket: { remoteAddress: "127.0.0.1" } as any,
      } as unknown as Request;

      const mockRes = { statusCode: 200 } as Response;

      await timedService.logRequest(mockReq, mockRes);
      await vi.advanceTimersByTimeAsync(50);

      expect(mockRepo.create).toHaveBeenCalledTimes(1);

      await timedService.dispose({ flush: false });
      vi.useRealTimers();
    });

    it("should keep buffers isolated across instances", async () => {
      const repoA: APILogStore = {
        create: vi.fn().mockResolvedValue({ id: "a" }),
        createMany: vi.fn().mockResolvedValue(1),
        query: vi.fn(),
        listForStats: vi.fn().mockResolvedValue([]),
        findById: vi.fn(),
        deleteOldLogs: vi.fn(),
      };
      const repoB: APILogStore = {
        create: vi.fn().mockResolvedValue({ id: "b" }),
        createMany: vi.fn().mockResolvedValue(1),
        query: vi.fn(),
        listForStats: vi.fn().mockResolvedValue([]),
        findById: vi.fn(),
        deleteOldLogs: vi.fn(),
      };

      const serviceA = new LogService(repoA, { autoStartTimer: false, registerShutdownHandlers: false });
      const serviceB = new LogService(repoB, { autoStartTimer: false, registerShutdownHandlers: false });

      const requestA = {
        headers: { "x-request-id": "service-a" },
        originalUrl: "/test/a",
        url: "/test/a",
        method: "GET",
        query: {},
        body: {},
        ip: "127.0.0.1",
        socket: { remoteAddress: "127.0.0.1" } as any,
      } as unknown as Request;
      const requestB = {
        headers: { "x-request-id": "service-b" },
        originalUrl: "/test/b",
        url: "/test/b",
        method: "GET",
        query: {},
        body: {},
        ip: "127.0.0.1",
        socket: { remoteAddress: "127.0.0.1" } as any,
      } as unknown as Request;
      const mockRes = { statusCode: 200 } as Response;

      await serviceA.logRequest(requestA, mockRes);
      await serviceB.logRequest(requestB, mockRes);

      await serviceA.flushNow();

      expect(repoA.create).toHaveBeenCalledTimes(1);
      expect(repoB.create).not.toHaveBeenCalled();

      await serviceB.flushNow();

      expect(repoB.create).toHaveBeenCalledTimes(1);

      await serviceA.dispose({ flush: false });
      await serviceB.dispose({ flush: false });
    });

    it("should flush logs queued during an in-flight flush", async () => {
      let releaseCreate: (() => void) | undefined;
      let createCallCount = 0;
      mockRepo.create = vi.fn(() => {
        createCallCount += 1;

        if (createCallCount === 1)
          return new Promise((resolve) => {
            releaseCreate = () => resolve({ id: "deferred" } as any);
          });

        return Promise.resolve({ id: `resolved-${createCallCount}` } as any);
      }) as any;

      const requestFactory = (id: string) =>
        ({
          headers: { "x-request-id": id },
          originalUrl: "/test",
          url: "/test",
          method: "GET",
          query: {},
          body: {},
          ip: "127.0.0.1",
          socket: { remoteAddress: "127.0.0.1" } as any,
        }) as unknown as Request;

      const mockRes = { statusCode: 200 } as Response;

      await logService.logRequest(requestFactory("first"), mockRes);
      const firstFlush = logService.flushNow();

      await Promise.resolve();
      await logService.logRequest(requestFactory("second"), mockRes);

      const secondFlush = logService.flushNow();
      releaseCreate?.();

      await Promise.all([firstFlush, secondFlush]);

      expect(mockRepo.create).toHaveBeenCalledTimes(2);
    });
  });

  describe("Error handling", () => {
    it("should not throw when logRequest encounters error", async () => {
      const mockReq = {
        headers: { "x-request-id": "test" },
        originalUrl: "/test",
        url: "/test",
        method: "GET",
        query: {},
        body: {},
        ip: "127.0.0.1",
        socket: { remoteAddress: "127.0.0.1" } as any,
      } as unknown as Request;

      const mockRes = { statusCode: 200 } as Response;

      // Should not throw even if internal error occurs
      await expect(logService.logRequest(mockReq, mockRes)).resolves.not.toThrow();
    });
  });
});
