import { PrismaClient } from "@prisma/client";
import { EnvSpace } from "./env";

// 在测试环境中，DATABASE_URL 已经通过 vitest.config.ts 或 globalSetup.ts 设置
// Prisma 会自动使用 DATABASE_URL 环境变量
const prisma = new PrismaClient({
  log: EnvSpace.isTest ? [] : ["warn", "error"], // 测试环境下关闭日志
  // Connection pool configuration to prevent connection exhaustion
  datasources: {
    db: {
      url: EnvSpace.databaseUrl,
    },
  },
});

// Configure connection pool limits via DATABASE_URL query parameters
// Example: mysql://user:pass@host:3306/db?connection_limit=10&pool_timeout=20

export { prisma };

export * from "@prisma/client";
