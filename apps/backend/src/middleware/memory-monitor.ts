import { getLogger, LogCategory } from "@/util/logger";

const logger = getLogger("MemoryMonitor", LogCategory.SYSTEM);

/**
 * 启动内存监控定时器（与请求周期完全解耦）。
 * 使用 setInterval 而非 middleware，避免在每个请求上调用 process.memoryUsage()。
 * @returns 定时器句柄，可在测试或优雅关闭时调用 clearInterval() 停止监控
 */
export function startMemoryMonitor(options: {
  /** 日志间隔（毫秒） */
  intervalMs: number;
  /** 内存告警阈值（MB） */
  warningThresholdMb: number;
}): ReturnType<typeof setInterval> {
  const timer = setInterval(() => {
    const memUsage = process.memoryUsage();
    const heapUsedMb = memUsage.heapUsed / 1024 / 1024;
    const heapTotalMb = memUsage.heapTotal / 1024 / 1024;
    const rssMb = memUsage.rss / 1024 / 1024;
    const externalMb = memUsage.external / 1024 / 1024;
    const heapUsagePercent = memUsage.rss > 0 ? (memUsage.heapUsed / memUsage.rss) * 100 : 0;

    const logData = {
      heapUsedBytes: memUsage.heapUsed,
      heapTotalBytes: memUsage.heapTotal,
      rssBytes: memUsage.rss,
      externalBytes: memUsage.external,
      heapUsed: `${heapUsedMb.toFixed(1)}MB`,
      heapTotal: `${heapTotalMb.toFixed(1)}MB`,
      rss: `${rssMb.toFixed(1)}MB`,
      external: `${externalMb.toFixed(1)}MB`,
      heapUsagePercent: `${heapUsagePercent.toFixed(1)}%`,
    };

    if (heapUsedMb > options.warningThresholdMb) logger.warn("High memory usage detected", logData);
    else logger.info("Memory usage", logData);
  }, options.intervalMs);

  // 允许进程正常退出
  timer.unref();

  return timer;
}
