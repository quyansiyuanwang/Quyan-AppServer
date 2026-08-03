import { exec } from "node:child_process";
import { promisify } from "node:util";
import { createConnection } from "mysql2/promise";
import {
  assertTestDatabaseUrl,
  getDatabaseWorkerCount,
  getTestRunNamespace,
  workerDatabaseName,
} from "./test-worker-environment";

function baseDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;
  assertTestDatabaseUrl(databaseUrl);
  return databaseUrl;
}

function mysqlAdminOptions(databaseUrl: string) {
  const url = new URL(databaseUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  };
}

function baseDatabaseName(databaseUrl: string): string {
  const name = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//u, ""));
  if (!/^[A-Za-z0-9_]+$/u.test(name))
    throw new Error("Test database names may only contain letters, digits, and underscores");
  return name;
}

const execAsync = promisify(exec);

async function runPrismaPush(databaseUrl: string): Promise<void> {
  await execAsync("pnpm exec prisma db push --skip-generate --accept-data-loss", {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    windowsHide: true,
  });
}

export async function setup(): Promise<() => Promise<void>> {
  const databaseUrl = baseDatabaseUrl();
  const workerCount = getDatabaseWorkerCount();
  const namespace = getTestRunNamespace();
  const databaseName = baseDatabaseName(databaseUrl);
  const admin = await createConnection(mysqlAdminOptions(databaseUrl));
  const workerDatabaseNames = Array.from({ length: workerCount }, (_, index) =>
    workerDatabaseName(databaseName, index + 1, namespace),
  );

  async function dropWorkerDatabases(): Promise<void> {
    const teardownAdmin = await createConnection(mysqlAdminOptions(databaseUrl));
    try {
      for (const name of workerDatabaseNames) await teardownAdmin.query(`DROP DATABASE IF EXISTS \`${name}\``);
    } finally {
      await teardownAdmin.end();
    }
  }

  try {
    for (const name of workerDatabaseNames) {
      await admin.query(`DROP DATABASE IF EXISTS \`${name}\``);
      await admin.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    }
  } catch (error) {
    throw new Error(
      "Database test setup requires CREATE/DROP DATABASE privileges for the dedicated test database user",
      {
        cause: error,
      },
    );
  } finally {
    await admin.end();
  }

  try {
    await Promise.all(
      workerDatabaseNames.map((name) => {
        const workerUrl = new URL(databaseUrl);
        workerUrl.pathname = `/${name}`;
        return runPrismaPush(workerUrl.toString());
      }),
    );
  } catch (error) {
    await dropWorkerDatabases();
    throw error;
  }

  return dropWorkerDatabases;
}
