import cron from "node-cron";
import { getLogger, LogCategory } from "@/util/logger";
import { RelayChannelProviderRevenueService } from "./relay-channel-provider-revenue.service";

const logger = getLogger("RelayChannelProviderSettlementScheduler", LogCategory.SYSTEM);

export class RelayChannelProviderSettlementSchedulerService {
  private static instance: RelayChannelProviderSettlementSchedulerService;
  private task: ReturnType<typeof cron.schedule> | null = null;

  static getInstance(): RelayChannelProviderSettlementSchedulerService {
    if (!this.instance) this.instance = new RelayChannelProviderSettlementSchedulerService();
    return this.instance;
  }

  start(): void {
    if (this.task) return;
    this.task = cron.schedule("* * * * *", () => void this.run(), { timezone: "Asia/Shanghai" });
    void this.run();
  }

  stop(): void {
    this.task?.stop();
    this.task = null;
  }

  private async run(): Promise<void> {
    try {
      await RelayChannelProviderRevenueService.getInstance().runScheduledSettlements();
    } catch (error) {
      logger.error("Relay channel provider settlement scheduler failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
