import cron from "node-cron";
import { getLogger, LogCategory } from "@/util/logger";
import { DeveloperProjectService } from "./developer-project.service";
import { DeveloperProjectRepository } from "@/store/developer/developer-project.repository";
import { DeveloperProductPlatformService } from "./developer-product-platform.service";
import { Permission } from "@/constant/permission";

const logger = getLogger("DeveloperMonitorScheduler", LogCategory.SYSTEM);

export class DeveloperMonitorSchedulerService {
  private static instance: DeveloperMonitorSchedulerService;
  private started = false;
  private task: ReturnType<typeof cron.schedule> | null = null;

  static getInstance(): DeveloperMonitorSchedulerService {
    if (!this.instance) this.instance = new DeveloperMonitorSchedulerService();
    return this.instance;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.task = cron.schedule("* * * * *", () => void this.run());
    // A restart must not leave enabled monitors stale until the next minute boundary.
    void this.run();
  }

  stop(): void {
    this.task?.stop();
    this.task = null;
    this.started = false;
  }

  private async run(): Promise<void> {
    try {
      await DeveloperProjectRepository.getInstance().runWithSchedulerLock(() =>
        Promise.all([
          DeveloperProjectService.getInstance().runScheduledMonitorChecks((projectId, callback) =>
            DeveloperProductPlatformService.getInstance().executeMeteredForBackingProject(
              projectId,
              "status",
              Permission.PRODUCT_STATUS_WRITE,
              callback,
            ),
          ),
          DeveloperProjectService.getInstance().retryScheduledPushDeliveries(),
          DeveloperProductPlatformService.getInstance().retryScheduledRefunds(),
        ]).then(() => undefined),
      );
    } catch (error) {
      logger.error("Developer monitor scheduler failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
