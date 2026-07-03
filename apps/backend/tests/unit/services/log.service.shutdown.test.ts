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

  it("flushes buffered logs before exiting on SIGTERM", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => code as never) as any);
    const service = new LogService(mockRepo, {
      autoStartTimer: false,
      registerShutdownHandlers: true,
    });

    await service.logRequest(createRequest("sigterm-flush"), createResponse());
    service.start();

    process.emit("SIGTERM");
    for (let index = 0; index < 10 && exitSpy.mock.calls.length === 0; index += 1)
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });

    expect(mockRepo.create).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(0);

    await service.dispose({ flush: false });
  });

  it("flushes buffered logs on beforeExit without forcing process exit", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => code as never) as any);
    const service = new LogService(mockRepo, {
      autoStartTimer: false,
      registerShutdownHandlers: true,
    });

    await service.logRequest(createRequest("before-exit-flush"), createResponse());
    service.start();

    process.emit("beforeExit", 0);
    await Promise.resolve();
    await Promise.resolve();

    expect(mockRepo.create).toHaveBeenCalledTimes(1);
    expect(exitSpy).not.toHaveBeenCalled();

    await service.dispose({ flush: false });
  });
});
