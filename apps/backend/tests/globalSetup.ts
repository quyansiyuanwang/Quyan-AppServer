import { execSync } from "child_process";
import * as path from "path";
import dotenv from "dotenv";

function assertUsingTestDatabase(databaseUrl: string | undefined): void {
  if (!databaseUrl) throw new Error("DATABASE_URL is required for test setup");

  const normalized = databaseUrl.toLowerCase();
  const looksLikeTestDatabase =
    normalized.includes("_test") ||
    normalized.includes("-test") ||
    normalized.endsWith("test") ||
    normalized.includes("/test");

  if (!looksLikeTestDatabase)
    throw new Error(
      `Refusing to run tests with non-test DATABASE_URL: ${databaseUrl}. Please use .env.test or a dedicated test database.`,
    );
}

/**
 * 全局测试设置 - 在所有测试运行前执行一次
 */
export async function setup() {
  // 加载测试环境变量
  const envPath = path.resolve(process.cwd(), ".env.test");
  dotenv.config({ path: envPath, override: true });

  process.env.NODE_ENV = "test";
  assertUsingTestDatabase(process.env.DATABASE_URL);

  console.log("🔧 Setting up test environment...");
  console.log(`📊 Test Database: ${process.env.DATABASE_URL}`);

  try {
    // 运行数据库同步以确保测试数据库结构是最新的
    console.log("🔄 Syncing database schema...");
    // 不跳过 generate，避免 Prisma Client 与 schema 脱节导致测试在运行期出现未知字段错误
    execSync("pnpm exec prisma db push --force-reset --accept-data-loss", {
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
      stdio: "inherit",
    });

    console.log("✅ Test environment setup complete!");
  } catch (error) {
    console.error("❌ Failed to setup test environment:", error);
    throw error;
  }
}

/**
 * 全局测试清理 - 在所有测试运行完成后执行一次
 */
export async function teardown() {
  console.log("🧹 Cleaning up test environment...");
  // 可以在这里添加清理逻辑，比如关闭数据库连接
}
