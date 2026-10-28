import { PrismaClient } from "@prisma/client";
import { databaseDiagnosticLogs, attachDatabaseDiagnostics } from "./database-diagnostics";
import { getLogger, LogCategory } from "@/util/logger";
import { env } from "./env";

// 在测试环境中，DATABASE_URL 由 Vitest database worker setup 注入。
// Prisma 会自动使用 DATABASE_URL 环境变量
const prisma = new PrismaClient({
  log: databaseDiagnosticLogs(env.runtime.isTest),
  datasources: { db: { url: env.database.url } },
});
if (!env.runtime.isTest)
  attachDatabaseDiagnostics(prisma, (level) => {
    const logger = getLogger("Database", LogCategory.STORAGE);
    if (level === "warn") logger.warn("Database engine warning", { eventCode: "database.engine.warning" });
    else logger.error("Database engine operation failed", { eventCode: "database.engine.error" });
  });

// Do not put connection_limit, pool_timeout, or connect_timeout in DATABASE_URL.
// They are not mysql2 connection options and produce runtime warnings.

export { prisma };

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}

export * from "@prisma/client";
