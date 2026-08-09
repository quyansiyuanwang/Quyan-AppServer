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

  it("counts every batch item against the client rate limit", async () => {
    redis.isRedisAvailable.mockReturnValue(true);
    redis.get.mockResolvedValue("25");
    const service = new ServiceCtor(repository, redis);
    const request = {
      headers: {},
      method: "POST",
      path: "/v1/error-reports/client/batch",
      socket: { remoteAddress: "127.0.0.1" },
    } as unknown as Request;

    await expect(
      service.reportClientErrors(
        request,
        Array.from({ length: 6 }, (_, index) => ({
          source: "frontend" as const,
          errorType: "Error",
          message: `boom ${index}`,
        })),
      ),
    ).rejects.toThrow("rate limit");
    expect(repository.createErrorOccurrence).not.toHaveBeenCalled();
    expect(redis.increment).not.toHaveBeenCalled();
  });

  it("writes a small client batch in order and charges its full rate-limit weight", async () => {
    redis.isRedisAvailable.mockReturnValue(true);
    const service = new ServiceCtor(repository, redis);
    const request = {
      headers: {},
      method: "POST",
      path: "/v1/error-reports/client/batch",
      socket: { remoteAddress: "127.0.0.1" },
    } as unknown as Request;

    await service.reportClientErrors(request, [
      { source: "frontend", errorType: "Error", message: "first" },
      { source: "frontend", errorType: "Error", message: "second" },
    ]);

    expect(redis.increment).toHaveBeenCalledWith("error-report:client:127.0.0.1", 60, 2);
    expect(repository.createErrorOccurrence).toHaveBeenCalledTimes(2);
    expect(repository.createErrorOccurrence.mock.calls[0][0].message).toBe("first");
    expect(repository.createErrorOccurrence.mock.calls[1][0].message).toBe("second");
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
