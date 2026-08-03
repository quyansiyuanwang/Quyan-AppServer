import { availableParallelism } from "node:os";

export const TEST_DATABASE_URL_ENV = "APPSERVER_TEST_DATABASE_URL";
export const TEST_REDIS_DB_ENV = "APPSERVER_TEST_REDIS_DB";
export const TEST_RUN_NAMESPACE_ENV = "APPSERVER_TEST_RUN_NAMESPACE";

const MAX_REDIS_DATABASES = 16;
const MAX_DATABASE_WORKERS = 4;

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function getDatabaseWorkerCount(): number {
  const fallback = Math.min(MAX_DATABASE_WORKERS, Math.max(1, availableParallelism()));
  const workerCount = parsePositiveInteger(process.env.TEST_DB_WORKERS, fallback);

  if (workerCount > MAX_REDIS_DATABASES)
    throw new Error(`TEST_DB_WORKERS must not exceed ${MAX_REDIS_DATABASES} for Redis logical database isolation`);

  return workerCount;
}

export function getRedisDatabaseBase(): number {
  const base = Number.parseInt(String(process.env.TEST_REDIS_DB_BASE || "8"), 10);
  if (!Number.isSafeInteger(base) || base < 0 || base >= MAX_REDIS_DATABASES)
    throw new Error(`TEST_REDIS_DB_BASE must be an integer from 0 to ${MAX_REDIS_DATABASES - 1}`);

  if (base + getDatabaseWorkerCount() > MAX_REDIS_DATABASES)
    throw new Error("TEST_REDIS_DB_BASE and TEST_DB_WORKERS exceed Redis logical database capacity");

  return base;
}

export function getTestRunNamespace(): string {
  const namespace = String(process.env[TEST_RUN_NAMESPACE_ENV] || "").trim();
  if (!/^[a-z0-9]{8,32}$/u.test(namespace))
    throw new Error(`${TEST_RUN_NAMESPACE_ENV} must be an 8-32 character lowercase alphanumeric value`);

  return namespace;
}

export function getVitestWorkerIndex(): number {
  const workerId = Number.parseInt(String(process.env.VITEST_POOL_ID || ""), 10);
  const workerCount = getDatabaseWorkerCount();
  if (!Number.isSafeInteger(workerId) || workerId < 1 || workerId > workerCount)
    throw new Error(`VITEST_POOL_ID must be within 1..${workerCount} for database tests`);

  return workerId;
}

export function assertTestDatabaseUrl(databaseUrl: string | undefined): asserts databaseUrl is string {
  if (!databaseUrl) throw new Error("DATABASE_URL is required for database test setup");

  const normalized = databaseUrl.toLowerCase();
  if (
    !normalized.includes("_test") &&
    !normalized.includes("-test") &&
    !normalized.endsWith("test") &&
    !normalized.includes("/test")
  )
    throw new Error("Refusing to run database tests with a non-test DATABASE_URL");
}

export function workerDatabaseName(
  baseDatabaseName: string,
  workerIndex: number,
  namespace = getTestRunNamespace(),
): string {
  if (!/^[A-Za-z0-9_]+$/u.test(baseDatabaseName))
    throw new Error("Test database names may only contain letters, digits, and underscores");
  return `${baseDatabaseName}__vitest_${namespace}_${workerIndex}`;
}

export function workerDatabaseUrl(baseDatabaseUrl: string, workerIndex: number): string {
  assertTestDatabaseUrl(baseDatabaseUrl);
  const url = new URL(baseDatabaseUrl);
  const baseDatabaseName = decodeURIComponent(url.pathname.replace(/^\//u, ""));
  if (!baseDatabaseName) throw new Error("DATABASE_URL must include a database name");

  url.pathname = `/${workerDatabaseName(baseDatabaseName, workerIndex)}`;
  return url.toString();
}
