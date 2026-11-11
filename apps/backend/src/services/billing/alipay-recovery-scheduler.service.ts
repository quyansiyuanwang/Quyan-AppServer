import cron from "node-cron";
import { createConnection } from "mysql2/promise";
import { env } from "@/config/env";
import { AlipayPaymentService } from "./alipay-payment.service";
import { getLogger, LogCategory } from "@/util/logger";
import { ALIPAY_POLICY } from "./alipay-policy";

const lockKey = "appserver:alipay-recovery";
const logger = getLogger("AlipayRecovery", LogCategory.SYSTEM);
export class AlipayRecoverySchedulerService {
  private static instance: AlipayRecoverySchedulerService;
  private task: ReturnType<typeof cron.schedule> | null = null;
  private running = false;
  static getInstance() {
    return (this.instance ??= new AlipayRecoverySchedulerService());
  }
  start() {
    if (this.task) return;
    this.task = cron.schedule(ALIPAY_POLICY.recoveryCron, () => void this.run());
    void this.run();
  }
  stop() {
    this.task?.stop();
    this.task = null;
  }
  private async run() {
    if (this.running) return;
    this.running = true;
    let connection: Awaited<ReturnType<typeof createConnection>> | undefined;
    try {
      const url = new URL(env.database.url);
      ["connection_limit", "pool_timeout", "connect_timeout"].forEach((key) => url.searchParams.delete(key));
      connection = await createConnection(url.toString());
      const [rows] = await connection.query("SELECT GET_LOCK(?, 0) AS acquired", [lockKey]);
      if (!Array.isArray(rows) || Number((rows[0] as { acquired?: unknown } | undefined)?.acquired) !== 1) return;
      await AlipayPaymentService.getInstance().recover();
    } catch {
      logger.error("Alipay recovery run failed", { reason: "database-or-provider-unavailable" });
    } finally {
      if (connection) {
        await connection.query("SELECT RELEASE_LOCK(?)", [lockKey]).catch(() => undefined);
        await connection.end().catch(() => undefined);
      }
      this.running = false;
    }
  }
}
