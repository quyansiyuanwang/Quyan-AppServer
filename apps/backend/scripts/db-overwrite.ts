import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// _prisma_migrations 表的数据结构
interface MigrationRecord {
  id: string;
  checksum: string;
  finished_at: Date | null;
  migration_name: string;
  logs: string | null;
  rolled_back_at: Date | null;
  started_at: Date;
  applied_steps_count: number;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 备份 _prisma_migrations 表数据
async function backupMigrationsTable(prisma: PrismaClient): Promise<MigrationRecord[]> {
  try {
    console.log("💾 [步骤 0/3] 备份 _prisma_migrations 表数据...");
    const migrationsBackup = await prisma.$queryRaw<MigrationRecord[]>`
      SELECT * FROM _prisma_migrations
    `;
    console.log(`✅ 已备份 ${migrationsBackup.length} 条迁移记录\n`);
    return migrationsBackup;
  } catch (err: any) {
    if (err.message.includes("doesn't exist")) console.log("ℹ️  _prisma_migrations 表不存在, 跳过备份\n");
    else console.warn(`⚠️  备份 _prisma_migrations 表失败: ${err.message}\n`);

    return [];
  }
}

// 删除并重建数据库
async function dropAndRecreateDatabase(): Promise<void> {
  console.log("🗑️  [步骤 1/3] 删除并重建数据库... (请确保当前 PrismaClient 连接有足够权限)");
  await prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS taoliya_blog`);
  await prisma.$executeRawUnsafe(`CREATE DATABASE taoliya_blog CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  console.log("✅ 数据库重建成功\n");
}

// 解析 SQL 文件为语句数组
function parseSqlStatements(sqlContent: string): string[] {
  const lines = sqlContent.split("\n");
  const statements: string[] = [];
  let currentStatement = "";

  for (const line of lines) {
    const trimmedLine = line.trim();

    // 跳过注释行, 空行和 MySQL 特殊指令
    if (
      trimmedLine.startsWith("--") ||
      trimmedLine.startsWith("/*") ||
      trimmedLine.startsWith("/*!") ||
      trimmedLine.length === 0
    )
      continue;

    // 累积当前语句
    currentStatement += line + "\n";

    // 如果行以分号结尾,说明语句结束
    if (trimmedLine.endsWith(";")) {
      const stmt = currentStatement.trim();
      // 再次检查,过滤掉 MySQL 特殊指令
      if (stmt.length > 0 && !stmt.startsWith("/*!")) statements.push(stmt);

      currentStatement = "";
    }
  }

  return statements;
}

// 判断是否为 _prisma_migrations 表的 INSERT 语句
function isMigrationsInsertStatement(stmt: string): boolean {
  return stmt.toUpperCase().includes("INSERT INTO") && stmt.includes("_prisma_migrations");
}

// 执行单条 SQL 语句
async function executeSqlStatement(
  prisma: PrismaClient,
  stmt: string,
  index: number,
): Promise<{ success: boolean; skipped: boolean }> {
  try {
    await prisma.$executeRawUnsafe(stmt);
    return { success: true, skipped: false };
  } catch (err: any) {
    // 跳过某些 Prisma 不支持的语句
    if (
      err.message.includes("This command is not supported") ||
      err.message.includes("You have an error in your SQL syntax")
    )
      return { success: false, skipped: true };
    else if (!err.message.includes("doesn't exist") && !err.message.includes("already exists"))
      console.error(`\n⚠️  警告 (语句 ${index + 1}): ${err.message.substring(0, 100)}`);

    return { success: false, skipped: false };
  }
}

// 导入 SQL 备份数据
async function importSqlBackup(prisma: PrismaClient, statements: string[]): Promise<void> {
  console.log("📥 [步骤 2/3] 正在导入备份数据...");
  console.log("⏳ 这可能需要一些时间, 请耐心等待...\n");
  console.log("🚀 使用 Prisma 执行 SQL 文件...");
  console.log(`📊 共 ${statements.length} 条 SQL 语句\n`);

  if (statements.length === 0) throw new Error("未能解析出任何 SQL 语句!");

  let successCount = 0;
  let skippedCount = 0;
  let migrationsSkippedCount = 0;

  for (let i = 0; i < statements.length; i++) {
    if (i % 100 === 0 || i === statements.length - 1) {
      const progress = Math.round((i / statements.length) * 100);
      console.log(`⏳ 进度: ${progress}% (${i + 1}/${statements.length})`);
    }

    const stmt = statements[i];

    // 跳过 _prisma_migrations 表的 INSERT 语句
    if (isMigrationsInsertStatement(stmt)) {
      migrationsSkippedCount++;
      continue;
    }

    const result = await executeSqlStatement(prisma, stmt, i);
    if (result.success) successCount++;
    else if (result.skipped) skippedCount++;
  }

  console.log(
    `\n✅ 数据导入成功 (执行: ${successCount}, 跳过: ${skippedCount}, _prisma_migrations跳过: ${migrationsSkippedCount}, 总计: ${statements.length})\n`,
  );
}

// 确保 _prisma_migrations 表存在
async function ensureMigrationsTableExists(prisma: PrismaClient): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(`SELECT 1 FROM _prisma_migrations LIMIT 1`);
  } catch (err: any) {
    if (err.message.includes("doesn't exist")) {
      console.log("📝 创建 _prisma_migrations 表...");
      // cSpell: words InnoDB
      await prisma.$executeRawUnsafe(`
        CREATE TABLE _prisma_migrations (
          id VARCHAR(36) NOT NULL PRIMARY KEY,
          checksum VARCHAR(64) NOT NULL,
          finished_at DATETIME(3),
          migration_name VARCHAR(255) NOT NULL,
          logs TEXT,
          rolled_back_at DATETIME(3),
          started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
          applied_steps_count INT UNSIGNED NOT NULL DEFAULT 0
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    }
  }
}

// 恢复 _prisma_migrations 表数据
async function restoreMigrationsTable(prisma: PrismaClient, migrationsBackup: MigrationRecord[]): Promise<void> {
  if (migrationsBackup.length === 0) {
    console.log("ℹ️  [步骤 3/3] 无需恢复 _prisma_migrations 表 (无备份数据)\n");
    return;
  }

  try {
    console.log("♻️  [步骤 3/3] 恢复 _prisma_migrations 表数据...");

    // 确保表存在
    await ensureMigrationsTableExists(prisma);

    // 清空表 (如果有数据)
    await prisma.$executeRawUnsafe(`DELETE FROM _prisma_migrations`);

    // 插入备份的数据
    for (const record of migrationsBackup)
      await prisma.$executeRawUnsafe(
        `INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        record.id,
        record.checksum,
        record.finished_at,
        record.migration_name,
        record.logs,
        record.rolled_back_at,
        record.started_at,
        record.applied_steps_count,
      );

    console.log(`✅ 已恢复 ${migrationsBackup.length} 条迁移记录\n`);
  } catch (err: any) {
    console.error(`⚠️  恢复 _prisma_migrations 表失败: ${err.message}\n`);
  }
}

// 查找最新的备份文件
function findLatestBackupFile() {
  const sqlDir = path.join(__dirname, "..", "backend-sql");
  const files = fs.readdirSync(sqlDir);

  const backupFiles = files
    .filter((file) => file.match(/^taoliya_blog_backup_(\d{8})_(\d{6})\.sql$/))
    .map((file) => {
      const match = file.match(/taoliya_blog_backup_(\d{8})_(\d{6})\.sql/);
      if (match) {
        const dateStr = match[1]; // YYYYMMDD
        const timeStr = match[2]; // HHMMSS

        // 转换为时间戳用于比较
        const year = dateStr.substring(0, 4);
        const month = dateStr.substring(4, 6);
        const day = dateStr.substring(6, 8);
        const hour = timeStr.substring(0, 2);
        const minute = timeStr.substring(2, 4);
        const second = timeStr.substring(4, 6);

        const timestamp = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`);

        return {
          filename: file,
          filepath: path.join(sqlDir, file),
          timestamp: timestamp,
        };
      }
      return null;
    })
    .filter((i) => i !== null)
    .sort((a, b) => Number(b.timestamp) - Number(a.timestamp));

  return backupFiles[0];
}

// 执行数据库还原
async function restoreDatabase() {
  console.log("====================================");
  console.log("数据库还原脚本");
  console.log("====================================\n");

  // 查找最新备份
  const latestBackup = findLatestBackupFile();

  if (!latestBackup) {
    console.error("❌ 错误: 未找到任何备份文件!");
    return;
  }

  console.log(`✅ 找到最新备份: ${latestBackup.filename}`);
  console.log(`📅 备份时间: ${latestBackup.timestamp.toLocaleString("zh-CN")}\n`);

  // 读取 SQL 文件
  console.log("📖 正在读取备份文件...");
  const sqlContent = fs.readFileSync(latestBackup.filepath, "utf8");

  // 获取文件大小
  const fileSizeMB = (fs.statSync(latestBackup.filepath).size / (1024 * 1024)).toFixed(2);
  console.log(`📦 文件大小: ${fileSizeMB} MB\n`);

  try {
    console.log("🔌 正在连接数据库...");

    // 步骤 0: 备份 _prisma_migrations 表数据
    const migrationsBackup = await backupMigrationsTable(prisma);

    // 步骤 1: 删除并重建数据库
    await prisma.$disconnect();
    await dropAndRecreateDatabase();

    // 步骤 2: 导入备份数据
    const prismaNew = new PrismaClient();
    const statements = parseSqlStatements(sqlContent);
    await importSqlBackup(prismaNew, statements);

    // 步骤 3: 恢复 _prisma_migrations 表数据
    await restoreMigrationsTable(prismaNew, migrationsBackup);

    await prismaNew.$disconnect();

    console.log("====================================");
    console.log("🎉 数据库还原完成!");
    console.log(`📦 已还原备份: ${latestBackup.filename}`);
    console.log("====================================");
  } catch (error: any) {
    console.error("\n❌ 错误:", error.message);
    console.error(error.stack);
    return;
  }
}

// 运行脚本
restoreDatabase().catch(console.error);
