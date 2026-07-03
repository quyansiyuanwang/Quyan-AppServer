import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { gzipSync } from "zlib";
import { SystemService } from "@/services/system/system.service";
import { INTERNAL_LOG_METADATA_KEY } from "@/config/logging";

describe("SystemService", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
  });

  it("should attach username and derived request/response sizes in log list", async () => {
    const apiLogRepository = {
      query: vi.fn().mockResolvedValue({
        logs: [
          {
            id: "log-1",
            status: 1,
            createTime: new Date("2025-01-01T00:00:00.000Z"),
            updateTime: new Date("2025-01-01T00:00:00.000Z"),
            requestID: "req-1",
            userID: "user-1",
            path: "/api/test",
            method: "POST",
            queryParams: null,
            bodyParams: { message: "hello" },
            requestHeaders: {
              "content-length": "17",
              [INTERNAL_LOG_METADATA_KEY]: {
                responseSizeBytes: 42,
              },
            },
            ipAddress: "127.0.0.1",
            statusCode: 200,
          },
        ],
        total: 1,
      }),
      findById: vi.fn(),
    };

    const userRepository = {
      findUsernamesByIds: vi.fn().mockResolvedValue([{ id: "user-1", username: "alice" }]),
      findActiveUsernameById: vi.fn(),
    };

    const service = new (SystemService as any)(apiLogRepository, userRepository, {}, {}) as SystemService;
    const result = await service.getLogs(1, 10);

    expect(result.total).toBe(1);
    expect(result.logs).toHaveLength(1);
    expect(result.logs[0]).toMatchObject({
      username: "alice",
      requestSizeBytes: 17,
      requestSizeFormatted: "17B",
      responseSizeBytes: 42,
      responseSizeFormatted: "42B",
    });
    expect(result.logs[0]).toEqual(
      expect.objectContaining({
        id: "log-1",
        requestID: "req-1",
      }),
    );
    expect(result.logs[0]).not.toHaveProperty("requestHeaders");
  });

  it("should strip internal metadata from request headers in log detail", async () => {
    const apiLogRepository = {
      query: vi.fn(),
      findById: vi.fn().mockResolvedValue({
        id: "log-2",
        status: 1,
        createTime: new Date("2025-01-01T00:00:00.000Z"),
        updateTime: new Date("2025-01-01T00:00:00.000Z"),
        requestID: "req-2",
        userID: "user-2",
        path: "/api/test",
        method: "GET",
        queryParams: { q: "x" },
        bodyParams: null,
        requestHeaders: {
          accept: "application/json",
          [INTERNAL_LOG_METADATA_KEY]: {
            responseSizeBytes: 128,
          },
        },
        responseHeaders: {
          "content-type": "application/json",
          "x-request-id": "req-2",
        },
        ipAddress: "127.0.0.1",
        response: { ok: true },
        statusCode: 200,
      }),
    };

    const userRepository = {
      findUsernamesByIds: vi.fn(),
      findActiveUsernameById: vi.fn().mockResolvedValue("bob"),
    };

    const service = new (SystemService as any)(apiLogRepository, userRepository, {}, {}) as SystemService;
    const detail = await service.getLogDetail("log-2");

    expect(detail).not.toBeNull();
    expect(detail).toMatchObject({
      username: "bob",
      requestSizeBytes: 0,
      requestSizeFormatted: "0B",
      requestSizeSource: "empty-body",
      responseSizeBytes: 128,
      responseSizeFormatted: "128B",
    });
    expect(detail?.requestHeaders).toEqual({
      accept: "application/json",
    });
    expect(detail?.responseHeaders).toEqual({
      "content-type": "application/json",
      "x-request-id": "req-2",
    });
  });

  it("should fall back to legacy response headers stored in request header metadata", async () => {
    const apiLogRepository = {
      query: vi.fn(),
      findById: vi.fn().mockResolvedValue({
        id: "log-legacy",
        status: 1,
        createTime: new Date("2025-01-01T00:00:00.000Z"),
        updateTime: new Date("2025-01-01T00:00:00.000Z"),
        requestID: "req-legacy",
        userID: "user-legacy",
        path: "/api/legacy",
        method: "GET",
        queryParams: null,
        bodyParams: null,
        requestHeaders: {
          accept: "application/json",
          [INTERNAL_LOG_METADATA_KEY]: {
            responseSizeBytes: 12,
            responseHeaders: {
              "content-type": "application/json",
            },
          },
        },
        responseHeaders: null,
        ipAddress: "127.0.0.1",
        response: { ok: true },
        statusCode: 200,
      }),
    };

    const userRepository = {
      findUsernamesByIds: vi.fn(),
      findActiveUsernameById: vi.fn().mockResolvedValue("legacy-user"),
    };

    const service = new (SystemService as any)(apiLogRepository, userRepository, {}, {}) as SystemService;
    const detail = await service.getLogDetail("log-legacy");

    expect(detail?.responseHeaders).toEqual({
      "content-type": "application/json",
    });
  });

  it("should keep relay log detail response visible while stripping internal header metadata", async () => {
    const apiLogRepository = {
      query: vi.fn(),
      findById: vi.fn().mockResolvedValue({
        id: "relay-log-1",
        status: 1,
        createTime: new Date("2026-05-04T00:00:00.000Z"),
        updateTime: new Date("2026-05-04T00:00:00.000Z"),
        requestID: "relay-req-1",
        userID: "user-3",
        path: "/relay/proxy/v1/chat/completions",
        method: "POST",
        queryParams: null,
        bodyParams: { stream: true },
        requestHeaders: {
          authorization: "***FILTERED***",
          [INTERNAL_LOG_METADATA_KEY]: {
            responseSizeBytes: 512,
          },
        },
        ipAddress: "127.0.0.1",
        response: 'data: {"id":"chunk-1"}\n\ndata: [DONE]\n\n',
        statusCode: 200,
      }),
    };

    const userRepository = {
      findUsernamesByIds: vi.fn(),
      findActiveUsernameById: vi.fn().mockResolvedValue("relay-user"),
    };

    const service = new (SystemService as any)(apiLogRepository, userRepository, {}, {}) as SystemService;
    const detail = await service.getLogDetail("relay-log-1");

    expect(detail).not.toBeNull();
    expect(detail).toMatchObject({
      path: "/relay/proxy/v1/chat/completions",
      username: "relay-user",
      responseSizeBytes: 512,
      responseSizeFormatted: "512B",
    });
    expect(detail?.response).toContain("data: [DONE]");
    expect(detail?.requestHeaders).toEqual({
      authorization: "***FILTERED***",
    });
  });

  it("should read only the matched tail lines from plain server logs", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "system-service-logs-"));
    const logsDir = path.join(tempRoot, "logs");
    await fs.ensureDir(logsDir);

    const fileName = "combined-2026-05-01.log";
    const filePath = path.join(logsDir, fileName);
    await fs.writeFile(filePath, ["line-1", "match-1", "line-3", "match-2", "match-3"].join("\n"));

    const service = new (SystemService as any)({ query: vi.fn(), findById: vi.fn() }, {}, {}, {}) as SystemService;
    (service as any).logsDir = logsDir;

    const result = await service.getServerLogContent(fileName, 2, "match");

    expect(result).not.toBeNull();
    expect(result).toMatchObject({
      totalLineCount: 5,
      matchedLineCount: 3,
      returnedLines: 2,
      truncated: true,
      content: "match-2\nmatch-3",
    });

    await fs.remove(tempRoot);
  });

  it("should read compressed server logs without loading separate parsing behavior into callers", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "system-service-logs-gz-"));
    const logsDir = path.join(tempRoot, "logs");
    await fs.ensureDir(logsDir);

    const fileName = "error-2026-05-01.log.gz";
    const filePath = path.join(logsDir, fileName);
    await fs.writeFile(filePath, gzipSync(Buffer.from(["err-1", "err-2", "err-3"].join("\n"), "utf8")));

    const service = new (SystemService as any)({ query: vi.fn(), findById: vi.fn() }, {}, {}, {}) as SystemService;
    (service as any).logsDir = logsDir;

    const result = await service.getServerLogContent(fileName, 2);

    expect(result).not.toBeNull();
    expect(result).toMatchObject({
      totalLineCount: 3,
      matchedLineCount: 3,
      returnedLines: 2,
      truncated: true,
      content: "err-2\nerr-3",
    });

    await fs.remove(tempRoot);
  });
});
