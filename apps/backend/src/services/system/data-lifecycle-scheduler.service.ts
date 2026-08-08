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
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private scheduleKey: string | null = null;

  public static getInstance(): DataLifecycleSchedulerService {
    if (!this.instance) this.instance = new DataLifecycleSchedulerService();
    return this.instance;
  }

  public start(): void {
    if (this.refreshTimer) return;
    void this.refreshSchedule();
    this.refreshTimer = setInterval(() => void this.refreshSchedule(), 60_000);
    this.refreshTimer.unref?.();
    void DataLifecycleService.getInstance()
      .initialize()
      .catch((error) => logger.error("Failed to initialize data lifecycle policies", { error: String(error) }));
  }

  public stop(): void {
    this.task?.stop();
    this.task = null;
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = null;
    this.scheduleKey = null;
  }

  public async refreshSchedule(): Promise<void> {
    try {
      const schedule = await DataLifecycleService.getInstance().getSchedule();
      const scheduleKey = schedule.enabled ? `${schedule.time}|${schedule.timezone}` : "disabled";
      if (scheduleKey === this.scheduleKey) return;

      this.task?.stop();
      this.task = null;
      this.scheduleKey = scheduleKey;
      if (!schedule.enabled) return;

      const [hour, minute] = schedule.time.split(":").map(Number);
      this.task = cron.schedule(`${minute} ${hour} * * *`, () => void this.run(), { timezone: schedule.timezone });
      logger.info("Data lifecycle schedule updated", { time: schedule.time, timezone: schedule.timezone });
    } catch (error) {
      logger.error("Failed to refresh data lifecycle schedule", { error: String(error) });
    }
  }

  public async run(): Promise<void> {
    await this.withLock(async () => {
      await ErrorReportService.getInstance().cleanupExpired();
      await DataLifecycleService.getInstance().runScheduledPolicies();
      await DataLifecycleService.getInstance().deleteExpiredArtifacts();
    });
  }

  public async runManualBatch(datasets: string[], startedByUserId?: string) {
    return this.withLock(() => DataLifecycleService.getInstance().runPolicies(datasets, "manual", startedByUserId));
  }

  private async withLock<T>(task: () => Promise<T>): Promise<T | null> {
    const lockService = DistributedLockService.getInstance();
    const lock = await lockService.acquire(DistributedLockService.buildKey("system", "data-lifecycle"), {
      ttlMs: LOCK_TTL_MS,
      acquireTimeoutMs: 100,
      failClosed: false,
    });
    if (!lock.acquired) return null;

    const heartbeat = setInterval(() => void lockService.extend(lock, LOCK_TTL_MS), LOCK_TTL_MS / 3);
    heartbeat.unref?.();
    try {
      return await task();
    } catch (error) {
      logger.error("Data lifecycle scheduler failed", { error: String(error) });
      return null;
    } finally {
      clearInterval(heartbeat);
      await lockService.release(lock);
    }
  }
}
