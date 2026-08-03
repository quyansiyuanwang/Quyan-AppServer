import { beforeEach, describe, expect, it, vi } from "vitest";

type MemoryUsage = ReturnType<typeof process.memoryUsage>;

const { infoMock, warnMock, getLoggerMock } = vi.hoisted(() => ({
  infoMock: vi.fn(),
  warnMock: vi.fn(),
  getLoggerMock: vi.fn(() => ({
    info: infoMock,
    warn: warnMock,
  })),
}));

vi.mock("../../../src/util/logger", () => ({
  LogCategory: { SYSTEM: "SYSTEM" },
  getLogger: getLoggerMock,
}));

describe("memory monitor runtime", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("starts interval monitor, calls unref, and logs normal memory usage", async () => {
    const timer = { unref: vi.fn() };
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval").mockImplementation(((callback: () => void) => {
      (timer as any).__callback = callback;
      return timer as any;
    }) as typeof setInterval);
    const memoryUsageSpy = vi.spyOn(process, "memoryUsage").mockImplementation(
      () =>
        ({
          heapUsed: 50 * 1024 * 1024,
          heapTotal: 100 * 1024 * 1024,
          rss: 120 * 1024 * 1024,
          external: 10 * 1024 * 1024,
          arrayBuffers: 0,
        }) as MemoryUsage,
    );

    const { startMemoryMonitor } = await import("../../../src/middleware/memory-monitor");

    const result = startMemoryMonitor({ intervalMs: 5000, warningThresholdMb: 80 });

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 5000);
    expect(timer.unref).toHaveBeenCalledTimes(1);
    expect(result).toBe(timer);

    const callback = (timer as any).__callback as () => void;
    callback();

    expect(memoryUsageSpy).toHaveBeenCalledTimes(1);
    expect(infoMock).toHaveBeenCalledWith("Memory usage", {
      heapUsedBytes: 50 * 1024 * 1024,
      heapTotalBytes: 100 * 1024 * 1024,
      rssBytes: 120 * 1024 * 1024,
      externalBytes: 10 * 1024 * 1024,
      heapUsed: "50.0MB",
      heapTotal: "100.0MB",
      rss: "120.0MB",
      external: "10.0MB",
      heapUsagePercent: "41.7%",
    });
    expect(warnMock).not.toHaveBeenCalled();
  });

  it("logs warning when heap usage exceeds threshold", async () => {
    const timer = { unref: vi.fn() };
    vi.spyOn(globalThis, "setInterval").mockImplementation(((callback: () => void) => {
      (timer as any).__callback = callback;
      return timer as any;
    }) as typeof setInterval);
    vi.spyOn(process, "memoryUsage").mockImplementation(
      () =>
        ({
          heapUsed: 256 * 1024 * 1024,
          heapTotal: 300 * 1024 * 1024,
          rss: 320 * 1024 * 1024,
          external: 16 * 1024 * 1024,
          arrayBuffers: 0,
        }) as MemoryUsage,
    );

    const { startMemoryMonitor } = await import("../../../src/middleware/memory-monitor");
    startMemoryMonitor({ intervalMs: 1000, warningThresholdMb: 128 });

    const callback = (timer as any).__callback as () => void;
    callback();

    expect(warnMock).toHaveBeenCalledWith("High memory usage detected", {
      heapUsedBytes: 256 * 1024 * 1024,
      heapTotalBytes: 300 * 1024 * 1024,
      rssBytes: 320 * 1024 * 1024,
      externalBytes: 16 * 1024 * 1024,
      heapUsed: "256.0MB",
      heapTotal: "300.0MB",
      rss: "320.0MB",
      external: "16.0MB",
      heapUsagePercent: "80.0%",
    });
  });
});
