import { RedisService } from "@/services/infrastructure/redis.service";

/**
 * Memory leak detection and monitoring utilities
 */

interface MemoryStats {
  rss: number; // Resident Set Size
  heapTotal: number;
  heapUsed: number;
  external: number;
  arrayBuffers: number;
}

interface MemoryLeakWarning {
  timestamp: Date;
  type: "heap" | "rss" | "event-listeners";
  current: number;
  threshold: number;
  message: string;
}

class MemoryMonitor {
  private static instance: MemoryMonitor;
  private baselineMemory: MemoryStats | null = null;
  private warnings: MemoryLeakWarning[] = [];
  private readonly MAX_WARNINGS = 100;

  // Thresholds (in MB)
  private readonly HEAP_GROWTH_THRESHOLD = 100; // 100MB growth
  private readonly RSS_GROWTH_THRESHOLD = 200; // 200MB growth
  private readonly MAX_EVENT_LISTENERS = 100;

  private constructor() {}

  static getInstance(): MemoryMonitor {
    if (!MemoryMonitor.instance) MemoryMonitor.instance = new MemoryMonitor();

    return MemoryMonitor.instance;
  }

  /**
   * Set baseline memory usage (call at startup)
   */
  setBaseline(): void {
    const usage = process.memoryUsage();
    this.baselineMemory = {
      rss: usage.rss,
      heapTotal: usage.heapTotal,
      heapUsed: usage.heapUsed,
      external: usage.external,
      arrayBuffers: usage.arrayBuffers,
    };
  }

  /**
   * Get current memory usage
   */
  getCurrentMemory(): MemoryStats {
    const usage = process.memoryUsage();
    return {
      rss: usage.rss,
      heapTotal: usage.heapTotal,
      heapUsed: usage.heapUsed,
      external: usage.external,
      arrayBuffers: usage.arrayBuffers,
    };
  }

  /**
   * Check for memory leaks
   */
  checkMemoryLeak(): MemoryLeakWarning | null {
    if (!this.baselineMemory) {
      this.setBaseline();
      return null;
    }

    const current = this.getCurrentMemory();
    const heapGrowth = (current.heapUsed - this.baselineMemory.heapUsed) / 1024 / 1024;
    const rssGrowth = (current.rss - this.baselineMemory.rss) / 1024 / 1024;

    // Check heap growth
    if (heapGrowth > this.HEAP_GROWTH_THRESHOLD) {
      const warning: MemoryLeakWarning = {
        timestamp: new Date(),
        type: "heap",
        current: heapGrowth,
        threshold: this.HEAP_GROWTH_THRESHOLD,
        message: `Heap memory grew by ${heapGrowth.toFixed(2)}MB (threshold: ${this.HEAP_GROWTH_THRESHOLD}MB)`,
      };
      this.addWarning(warning);
      return warning;
    }

    // Check RSS growth
    if (rssGrowth > this.RSS_GROWTH_THRESHOLD) {
      const warning: MemoryLeakWarning = {
        timestamp: new Date(),
        type: "rss",
        current: rssGrowth,
        threshold: this.RSS_GROWTH_THRESHOLD,
        message: `RSS memory grew by ${rssGrowth.toFixed(2)}MB (threshold: ${this.RSS_GROWTH_THRESHOLD}MB)`,
      };
      this.addWarning(warning);
      return warning;
    }

    return null;
  }

  /**
   * Check event listener count on an EventEmitter
   */
  checkEventListeners(emitter: { listenerCount: (event: string) => number }, name: string): MemoryLeakWarning | null {
    const listenerCount =
      emitter.listenerCount("data") + emitter.listenerCount("error") + emitter.listenerCount("close");

    if (listenerCount > this.MAX_EVENT_LISTENERS) {
      const warning: MemoryLeakWarning = {
        timestamp: new Date(),
        type: "event-listeners",
        current: listenerCount,
        threshold: this.MAX_EVENT_LISTENERS,
        message: `${name} has ${listenerCount} event listeners (threshold: ${this.MAX_EVENT_LISTENERS})`,
      };
      this.addWarning(warning);
      return warning;
    }

    return null;
  }

  /**
   * Get memory usage summary
   */
  getMemorySummary(): {
    current: MemoryStats;
    baseline: MemoryStats | null;
    growth: {
      heap: number;
      rss: number;
    };
    } {
    const current = this.getCurrentMemory();
    const growth = this.baselineMemory
      ? {
        heap: (current.heapUsed - this.baselineMemory.heapUsed) / 1024 / 1024,
        rss: (current.rss - this.baselineMemory.rss) / 1024 / 1024,
      }
      : { heap: 0, rss: 0 };

    return {
      current,
      baseline: this.baselineMemory,
      growth,
    };
  }

  /**
   * Get recent warnings
   */
  getWarnings(limit: number = 10): MemoryLeakWarning[] {
    return this.warnings.slice(-limit);
  }

  /**
   * Clear warnings
   */
  clearWarnings(): void {
    this.warnings = [];
  }

  /**
   * Force garbage collection (if --expose-gc flag is set)
   */
  forceGC(): boolean {
    if (global.gc) {
      global.gc();
      return true;
    }
    return false;
  }

  private addWarning(warning: MemoryLeakWarning): void {
    this.warnings.push(warning);
    if (this.warnings.length > this.MAX_WARNINGS) this.warnings.shift();
  }
}

/**
 * Store memory metrics in Redis for monitoring
 */
export async function storeMemoryMetrics(): Promise<void> {
  const redis = RedisService.getInstance();
  if (!redis.isRedisAvailable()) return;

  const monitor = MemoryMonitor.getInstance();
  const summary = monitor.getMemorySummary();

  const key = `memory:metrics:${Date.now()}`;
  await redis.set(
    key,
    JSON.stringify({
      timestamp: new Date().toISOString(),
      heapUsed: summary.current.heapUsed,
      heapTotal: summary.current.heapTotal,
      rss: summary.current.rss,
      external: summary.current.external,
      heapGrowth: summary.growth.heap,
      rssGrowth: summary.growth.rss,
    }),
    3600, // 1 hour TTL
  );
}

export { MemoryMonitor };
export type { MemoryStats, MemoryLeakWarning };
