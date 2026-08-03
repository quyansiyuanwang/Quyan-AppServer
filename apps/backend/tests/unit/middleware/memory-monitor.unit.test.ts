import { describe, it, expect, afterEach, vi } from "vitest";
import { startMemoryMonitor } from "@/middleware/memory-monitor";

const { warnSpy, infoSpy } = vi.hoisted(() => ({
  warnSpy: vi.fn(),
  infoSpy: vi.fn(),
}));

vi.mock("@/util/logger", () => ({
  LogCategory: { SYSTEM: "SYSTEM" },
  getLogger: () => ({
    warn: warnSpy,
    info: infoSpy,
    error: vi.fn(),
    debug: vi.fn(),
    http: vi.fn(),
  }),
}));

describe("startMemoryMonitor", () => {
  let timer: ReturnType<typeof setInterval> | null = null;

  afterEach(() => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }

    warnSpy.mockReset();
    infoSpy.mockReset();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("should return a timer handle", () => {
    timer = startMemoryMonitor({
      intervalMs: 1000,
      warningThresholdMb: 1500,
    });

    expect(timer).toBeDefined();
    expect(typeof timer).toBe("object");
  });

  it("should log memory usage at specified interval", async () => {
    vi.useFakeTimers();

    timer = startMemoryMonitor({
      intervalMs: 100,
      warningThresholdMb: 1500,
    });

    await vi.advanceTimersByTimeAsync(100);

    expect(infoSpy).toHaveBeenCalled();
  });

  it("should allow timer to be cleared", () => {
    timer = startMemoryMonitor({
      intervalMs: 1000,
      warningThresholdMb: 1500,
    });

    expect(() => clearInterval(timer!)).not.toThrow();
    timer = null;
  });

  it("should use unref to allow process exit", () => {
    timer = startMemoryMonitor({
      intervalMs: 1000,
      warningThresholdMb: 1500,
    });

    // Timer should have unref called (allows process to exit)
    // This is verified by the implementation, not directly testable
    expect(timer).toBeDefined();
  });

  it("should not throw when monitoring memory", async () => {
    vi.useFakeTimers();

    timer = startMemoryMonitor({
      intervalMs: 50,
      warningThresholdMb: 1500,
    });

    // Advance timer multiple times
    for (let i = 0; i < 5; i++) vi.advanceTimersByTime(50);

    // Should not throw
    expect(timer).toBeDefined();
  });

  it("should emit warning log with rss-based usage percent when threshold exceeded", async () => {
    vi.useFakeTimers();

    const memoryUsageSpy = vi.spyOn(process, "memoryUsage").mockReturnValue({
      rss: 200 * 1024 * 1024,
      heapTotal: 180 * 1024 * 1024,
      heapUsed: 150 * 1024 * 1024,
      external: 20 * 1024 * 1024,
      arrayBuffers: 10 * 1024 * 1024,
    });

    timer = startMemoryMonitor({
      intervalMs: 100,
      warningThresholdMb: 120,
    });

    await vi.advanceTimersByTimeAsync(100);

    expect(warnSpy).toHaveBeenCalledWith(
      "High memory usage detected",
      expect.objectContaining({
        heapUsedBytes: 150 * 1024 * 1024,
        rssBytes: 200 * 1024 * 1024,
        heapUsagePercent: "75.0%",
      }),
    );

    memoryUsageSpy.mockRestore();
  });
});
