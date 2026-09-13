import cron from "node-cron";
import { createConnection } from "mysql2/promise";
import { env } from "@/config/env";
import { CarpoolService } from "@/services/billing/carpool.service";
import { getLogger, LogCategory } from "@/util/logger";

const logger = getLogger("CarpoolExpirationScheduler", LogCategory.SYSTEM);
const lockKey = "appserver:carpool-expiration-scheduler";

const schedulerDatabaseUrl = () => {
  const url = new URL(env.database.url);
  ["connection_limit", "pool_timeout", "connect_timeout"].forEach((parameter) => url.searchParams.delete(parameter));
  return url.toString();
};

export class CarpoolExpirationSchedulerService {
  private static instance: CarpoolExpirationSchedulerService;
  private task: ReturnType<typeof cron.schedule> | null = null;
  static getInstance() {
    return (this.instance ??= new CarpoolExpirationSchedulerService());
  }
  start() {
    if (this.task) return;
    this.task = cron.schedule("* * * * *", () => void this.run(), { timezone: "Asia/Shanghai" });
    void this.run();
  }
  stop() {
    this.task?.stop();
    this.task = null;
  }
  private async run() {
    let connection: Awaited<ReturnType<typeof createConnection>> | undefined;
    try {
      connection = await createConnection(schedulerDatabaseUrl());
      const [rows] = await connection.query("SELECT GET_LOCK(?, 0) AS acquired", [lockKey]);
      if (!Array.isArray(rows) || Number((rows[0] as { acquired?: unknown } | undefined)?.acquired) !== 1) return;
      const service = CarpoolService.getInstance();
      await service.backfillOpenOrderFormationDeadlines();
      await service.expireDueOrders();
    } catch (error) {
      logger.error("Carpool expiration scheduler failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (connection) {
        await connection.query("SELECT RELEASE_LOCK(?)", [lockKey]).catch(() => undefined);
        await connection.end().catch(() => undefined);
      }
    }
  }
}
