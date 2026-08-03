import { beforeAll } from "vitest";
import { createConnection, type RowDataPacket } from "mysql2/promise";
import Redis from "ioredis";
import {
  TEST_DATABASE_URL_ENV,
  TEST_REDIS_DB_ENV,
  getRedisDatabaseBase,
  getVitestWorkerIndex,
  workerDatabaseUrl,
} from "./test-worker-environment";

const workerIndex = getVitestWorkerIndex();
const baseDatabaseUrl = process.env.DATABASE_URL;
const workerUrl = workerDatabaseUrl(baseDatabaseUrl || "", workerIndex);

process.env[TEST_DATABASE_URL_ENV] = workerUrl;
process.env[TEST_REDIS_DB_ENV] = String(getRedisDatabaseBase() + workerIndex - 1);

function mysqlOptions(databaseUrl: string) {
  const url = new URL(databaseUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.replace(/^\//u, "")),
    multipleStatements: true,
  };
}

async function connectRedisWithin(redis: Redis, timeoutMs: number): Promise<void> {
  const connection = redis.connect();
  void connection.catch(() => undefined);

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      connection,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Redis connection timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

beforeAll(async () => {
  if (process.env.TEST_REDIS_REQUIRED === "true" || process.env.TEST_REDIS_CLEANUP === "true") {
    const redis = new Redis({
      host: process.env.REDIS_HOST || "127.0.0.1",
      port: Number(process.env.REDIS_PORT || 6379),
      password: process.env.REDIS_PASSWORD || undefined,
      db: Number(process.env[TEST_REDIS_DB_ENV]),
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
      connectTimeout: 500,
      retryStrategy: () => null,
    });

    try {
      await connectRedisWithin(redis, 500);
      await redis.flushdb();
    } finally {
      redis.disconnect();
    }
  }

  const connection = await createConnection(mysqlOptions(workerUrl));
  try {
    const [rows] = await connection.query<Array<RowDataPacket & { TABLE_NAME: string }>>(
      "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'",
    );
    if (rows.length === 0) return;

    await connection.query("SET FOREIGN_KEY_CHECKS = 0");
    try {
      // One request avoids a round trip per table while keeping cleanup scoped to
      // this worker's derived database.
      await connection.query(rows.map(({ TABLE_NAME: tableName }) => `TRUNCATE TABLE \`${tableName}\``).join(";"));
    } finally {
      await connection.query("SET FOREIGN_KEY_CHECKS = 1");
    }
  } finally {
    await connection.end();
  }
});
