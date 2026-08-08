import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request } from "express";

import { ErrorReportService } from "@/services/system/error-report.service";

describe("ErrorReportService", () => {
  const repository = {
    createErrorOccurrence: vi.fn(),
    deleteErrorsBefore: vi.fn(),
  };
  const redis = {
    isRedisAvailable: vi.fn(),
    get: vi.fn(),
    increment: vi.fn(),
  };
  const ServiceCtor = ErrorReportService as unknown as new (...args: any[]) => ErrorReportService;

  beforeEach(() => {
    vi.clearAllMocks();
    repository.createErrorOccurrence.mockResolvedValue(undefined);
    repository.deleteErrorsBefore.mockResolvedValue(0);
    redis.isRedisAvailable.mockReturnValue(false);
    redis.get.mockResolvedValue("0");
    redis.increment.mockResolvedValue(1);
  });

  it("masks sensitive context and creates a stable fingerprint for dynamic values", async () => {
    const service = new ServiceCtor(repository, redis);
    const first = {
      source: "frontend" as const,
      errorType: "TypeError",
      message: "Request 123 failed for user 456",
      route: "/settings",
      stack: "TypeError: failed\n    at load (app.ts:10:2)",
      context: { password: "secret", authorization: "Bearer abc", nested: { value: "ok" } },
    };

    await service.record(first);
    await service.record({ ...first, message: "Request 999 failed for user 111" });

    const calls = repository.createErrorOccurrence.mock.calls.map(([input]) => input);
    expect(calls[0].fingerprint).toBe(calls[1].fingerprint);
    expect(calls[0].context).toEqual({
      password: "***MASKED***",
      authorization: "***MASKED***",
      nested: { value: "ok" },
    });
    expect(calls[0].message).toContain("Request 123");
  });

  it("enforces the client rate limit when Redis is available", async () => {
    redis.isRedisAvailable.mockReturnValue(true);
    redis.get.mockResolvedValue("30");
    const service = new ServiceCtor(repository, redis);
    const request = {
      headers: {},
      method: "POST",
      path: "/v1/error-reports/client",
      socket: { remoteAddress: "127.0.0.1" },
    } as unknown as Request;

    await expect(
      service.reportClientError(request, {
        source: "frontend",
        errorType: "Error",
        message: "boom",
      }),
    ).rejects.toThrow("rate limit");
    expect(repository.createErrorOccurrence).not.toHaveBeenCalled();
  });

  it("uses a strict 90-day cleanup cutoff", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-08T00:00:00.000Z"));
    const service = new ServiceCtor(repository, redis);

    await service.cleanupExpired();

    expect(repository.deleteErrorsBefore).toHaveBeenCalledWith(new Date("2026-05-10T00:00:00.000Z"));
    vi.useRealTimers();
  });
});
