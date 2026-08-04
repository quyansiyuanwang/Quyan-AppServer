import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { LogService } from "@/services/system/log.service";
import type { APILogStore } from "@/store/system/apilog.store";

describe("LogService shutdown handlers", () => {
  let mockRepo: APILogStore;

  beforeEach(() => {
    mockRepo = {
      create: vi.fn().mockResolvedValue({ id: "test-id" }),
      createMany: vi.fn().mockResolvedValue(1),
      query: vi.fn(),
      listForStats: vi.fn().mockResolvedValue([]),
      findById: vi.fn(),
      deleteOldLogs: vi.fn(),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createRequest = (id: string) =>
    ({
      headers: { "x-request-id": id },
      originalUrl: "/test/shutdown",
      url: "/test/shutdown",
      method: "POST",
      query: {},
      body: { ok: true },
      ip: "127.0.0.1",
      socket: { remoteAddress: "127.0.0.1" } as any,
    }) as unknown as Request;

  const createResponse = () => ({ statusCode: 500 }) as Response;

  it("flushes buffered logs when disposed", async () => {
    const service = new LogService(mockRepo, {
      autoStartTimer: false,
    });

    await service.logRequest(createRequest("sigterm-flush"), createResponse());
    await service.dispose();

    expect(mockRepo.create).toHaveBeenCalledTimes(1);
  });

  it("does not register process-level shutdown handlers", async () => {
    const service = new LogService(mockRepo, {
      autoStartTimer: false,
    });

    await service.logRequest(createRequest("before-exit-flush"), createResponse());
    expect(process.listenerCount("SIGTERM")).toBe(0);
    expect(process.listenerCount("SIGINT")).toBe(0);
    expect(process.listenerCount("beforeExit")).toBe(0);
    await service.dispose();
  });
});
