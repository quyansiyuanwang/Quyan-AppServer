import { PrismaClient } from "@prisma/client";
import { EnvSpace } from "./env";

// 在测试环境中，DATABASE_URL 已经通过 vitest.config.ts 或 globalSetup.ts 设置
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

export * from "@prisma/client";
