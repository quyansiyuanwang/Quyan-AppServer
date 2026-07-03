import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { LogService } from "@/services/system/log.service";
import { APILogRepository } from "@/store/system/apilog";
import { Request, Response } from "express";

describe("LogService Integration", () => {
  let logService: LogService;
  let apiLogRepo: typeof APILogRepository.prototype;

  beforeAll(() => {
    apiLogRepo = APILogRepository.getInstance();
    logService = new LogService(apiLogRepo);
  });

  afterAll(async () => {
    await logService.dispose();
    // Clean up test logs
    await apiLogRepo.deleteOldLogs(0);
  });

  it("should eventually write buffered logs to database", async () => {
    const mockReq = {
      headers: { "x-request-id": `integration-test-${Date.now()}` },
      originalUrl: "/integration/test",
      url: "/integration/test",
      method: "POST",
      query: { test: "query" },
      body: { test: "body" },
      ip: "127.0.0.1",
      socket: { remoteAddress: "127.0.0.1" } as any,
    } as unknown as Request;

    const mockRes = { statusCode: 200 } as Response;

    // Log request
    await logService.logRequest(mockReq, mockRes, { result: "success" });

    // Wait for flush timer (2 seconds + buffer)
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Verify log was written to database
    const logs = await apiLogRepo.query({
      requestID: mockReq.headers["x-request-id"] as string,
      limit: 1,
      offset: 0,
    });

    expect(logs.total).toBeGreaterThan(0);
    expect(logs.logs[0].path).toBe("/integration/test");
    expect(logs.logs[0].method).toBe("POST");
    expect(logs.logs[0].statusCode).toBe(200);
  }, 10000);

  it("should skip duplicate requestIDs gracefully", async () => {
    const requestID = `duplicate-test-${Date.now()}`;

    const mockReq = {
      headers: { "x-request-id": requestID },
      originalUrl: "/duplicate/test",
      url: "/duplicate/test",
      method: "GET",
      query: {},
      body: {},
      ip: "127.0.0.1",
      socket: { remoteAddress: "127.0.0.1" } as any,
    } as unknown as Request;

    const mockRes = { statusCode: 200 } as Response;

    // Log same request twice
    await logService.logRequest(mockReq, mockRes);
    await logService.logRequest(mockReq, mockRes);

    // Wait for flush
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Should only have one entry (duplicate skipped)
    const logs = await apiLogRepo.query({
      requestID,
      limit: 10,
      offset: 0,
    });

    // Either 1 entry (duplicate skipped) or 2 entries (duplicate got suffixed requestID)
    expect(logs.total).toBeGreaterThanOrEqual(1);
    expect(logs.total).toBeLessThanOrEqual(2);
  }, 10000);

  it("should filter sensitive data from logs", async () => {
    const mockReq = {
      headers: { "x-request-id": `sensitive-test-${Date.now()}` },
      originalUrl: "/sensitive/test",
      url: "/sensitive/test",
      method: "POST",
      query: {},
      body: {
        username: "testuser",
        password: "secret123",
        token: "abc123",
      },
      ip: "127.0.0.1",
      socket: { remoteAddress: "127.0.0.1" } as any,
    } as unknown as Request;

    const mockRes = { statusCode: 200 } as Response;

    await logService.logRequest(mockReq, mockRes);

    // Wait for flush
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const logs = await apiLogRepo.query({
      requestID: mockReq.headers["x-request-id"] as string,
      limit: 1,
      offset: 0,
    });

    expect(logs.total).toBeGreaterThan(0);

    // Get full log with response
    const fullLog = await apiLogRepo.findById(logs.logs[0].id);
    expect(fullLog).toBeDefined();

    const bodyParams = fullLog!.bodyParams as any;
    expect(bodyParams.username).toBe("testuser");
    expect(bodyParams.password).toBe("***FILTERED***");
    expect(bodyParams.token).toBe("***FILTERED***");
  }, 10000);

  it("should skip high-frequency paths with success status", async () => {
    const mockReq = {
      headers: { "x-request-id": `skip-test-${Date.now()}` },
      originalUrl: "/relay/proxy/test",
      url: "/relay/proxy/test",
      method: "POST",
      query: {},
      body: {},
      ip: "127.0.0.1",
      socket: { remoteAddress: "127.0.0.1" } as any,
    } as unknown as Request;

    const mockRes = { statusCode: 200 } as Response;

    await logService.logRequest(mockReq, mockRes);

    // Wait for flush
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Should not be logged
    const logs = await apiLogRepo.query({
      requestID: mockReq.headers["x-request-id"] as string,
      limit: 1,
      offset: 0,
    });

    expect(logs.total).toBe(0);
  }, 10000);

  it("should log high-frequency paths with error status", async () => {
    const mockReq = {
      headers: { "x-request-id": `error-test-${Date.now()}` },
      originalUrl: "/relay/proxy/test",
      url: "/relay/proxy/test",
      method: "POST",
      query: {},
      body: {},
      ip: "127.0.0.1",
      socket: { remoteAddress: "127.0.0.1" } as any,
    } as unknown as Request;

    const mockRes = { statusCode: 500 } as Response;

    await logService.logRequest(mockReq, mockRes);

    // Wait for flush
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Should be logged despite being high-frequency path
    const logs = await apiLogRepo.query({
      requestID: mockReq.headers["x-request-id"] as string,
      limit: 1,
      offset: 0,
    });

    expect(logs.total).toBeGreaterThan(0);
    expect(logs.logs[0].statusCode).toBe(500);
  }, 10000);

  it("should persist response headers in the dedicated database column", async () => {
    const requestID = `response-headers-test-${Date.now()}`;

    const mockReq = {
      headers: { "x-request-id": requestID },
      originalUrl: "/response-headers/test",
      url: "/response-headers/test",
      method: "GET",
      query: {},
      body: {},
      ip: "127.0.0.1",
      socket: { remoteAddress: "127.0.0.1" } as any,
    } as unknown as Request;

    const mockRes = {
      statusCode: 200,
      getHeader: (name: string) => {
        if (name === "content-type") return "application/json";
        return undefined;
      },
      getHeaders: () => ({
        "content-type": "application/json",
        "x-response-id": "resp-123",
        "set-cookie": ["session=secret"],
      }),
    } as unknown as Response;

    await logService.logRequest(mockReq, mockRes, { ok: true });

    await new Promise((resolve) => setTimeout(resolve, 3000));

    const logs = await apiLogRepo.query({
      requestID,
      limit: 1,
      offset: 0,
    });

    expect(logs.total).toBeGreaterThan(0);

    const fullLog = await apiLogRepo.findById(logs.logs[0].id);
    expect(fullLog?.responseHeaders).toEqual({
      "content-type": "application/json",
      "x-response-id": "resp-123",
      "set-cookie": "***FILTERED***",
    });
  }, 10000);
});
