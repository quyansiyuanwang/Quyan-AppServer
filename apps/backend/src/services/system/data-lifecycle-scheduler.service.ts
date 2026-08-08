import cron from "node-cron";
import { DataLifecycleService } from "./data-lifecycle.service";
import { ErrorReportService } from "./error-report.service";
import { DistributedLockService } from "@/services/infrastructure/distributed-lock.service";
import { getLogger, LogCategory } from "@/util/logger";

const logger = getLogger("DataLifecycleScheduler", LogCategory.SYSTEM);
const LOCK_TTL_MS = 10 * 60 * 1000;

export class DataLifecycleSchedulerService {
  private static instance: DataLifecycleSchedulerService;
  private task: ReturnType<typeof cron.schedule> | null = null;

  public static getInstance(): DataLifecycleSchedulerService {
    if (!this.instance) this.instance = new DataLifecycleSchedulerService();
    return this.instance;
  }

  public start(): void {
    if (this.task) return;
    this.task = cron.schedule("20 3 * * *", () => void this.run(), { timezone: "Asia/Shanghai" });
    void DataLifecycleService.getInstance()
      .initialize()
      .catch((error) => logger.error("Failed to initialize data lifecycle policies", { error: String(error) }));
  }

  public stop(): void {
    this.task?.stop();
    this.task = null;
  }

  public async run(): Promise<void> {
    const lockService = DistributedLockService.getInstance();
    const lock = await lockService.acquire(DistributedLockService.buildKey("system", "data-lifecycle"), {
      ttlMs: LOCK_TTL_MS,
      acquireTimeoutMs: 100,
      failClosed: false,
    });
    if (!lock.acquired) return;

    const heartbeat = setInterval(() => void lockService.extend(lock, LOCK_TTL_MS), LOCK_TTL_MS / 3);
    heartbeat.unref?.();
    try {
      await ErrorReportService.getInstance().cleanupExpired();
      await DataLifecycleService.getInstance().runScheduledPolicies();
      await DataLifecycleService.getInstance().deleteExpiredArtifacts();
    } catch (error) {
      logger.error("Data lifecycle scheduler failed", { error: String(error) });
    } finally {
      clearInterval(heartbeat);
      await lockService.release(lock);
    }
  }
}
