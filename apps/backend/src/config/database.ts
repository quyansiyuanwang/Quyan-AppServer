import { PrismaClient } from "@prisma/client";
import { EnvSpace } from "./env";

// 在测试环境中，DATABASE_URL 由 Vitest database worker setup 注入。
// Prisma 会自动使用 DATABASE_URL 环境变量
const prisma = new PrismaClient({
  log: EnvSpace.isTest ? [] : ["warn", "error"], // 测试环境下关闭日志
  datasources: {
    db: {
      url: EnvSpace.databaseUrl,
    },
  },
});

// Do not put connection_limit, pool_timeout, or connect_timeout in DATABASE_URL.
// They are not mysql2 connection options and produce runtime warnings.

export { prisma };

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}

export * from "@prisma/client";
