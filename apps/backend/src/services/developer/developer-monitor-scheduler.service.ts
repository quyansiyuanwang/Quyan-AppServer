import cron from "node-cron";
import { getLogger, LogCategory } from "@/util/logger";
import { DeveloperProjectService } from "./developer-project.service";
import { DeveloperProjectRepository } from "@/store/developer/developer-project.repository";

const logger = getLogger("DeveloperMonitorScheduler", LogCategory.SYSTEM);

export class DeveloperMonitorSchedulerService {
  private static instance: DeveloperMonitorSchedulerService;
  private started = false;

  static getInstance(): DeveloperMonitorSchedulerService {
    if (!this.instance) this.instance = new DeveloperMonitorSchedulerService();
    return this.instance;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    cron.schedule("* * * * *", () => void this.run());
  }

  private async run(): Promise<void> {
    try {
      await DeveloperProjectRepository.getInstance().runWithSchedulerLock(() =>
        Promise.all([
          DeveloperProjectService.getInstance().runScheduledMonitorChecks(),
          DeveloperProjectService.getInstance().retryScheduledPushDeliveries(),
        ]).then(() => undefined),
      );
    } catch (error) {
      logger.error("Developer monitor scheduler failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
