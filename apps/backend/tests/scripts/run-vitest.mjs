import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { canReusePrismaClient } from "./prisma-client-readiness.mjs";

const namespace = randomBytes(12).toString("hex");
const vitestArgs = process.argv.slice(2);
// Some pure services import Prisma-generated types without opening a database
// connection. Reuse a matching generated client to avoid rewriting a Windows
// engine DLL loaded by the dev server. Changed schemas, CLI versions or a clean
// checkout still generate; database bootstrap remains database-project-only.
const needsPrismaGenerate = !canReusePrismaClient(process.cwd());
const spawnOptions = {
  cwd: process.cwd(),
  env: { ...process.env, APPSERVER_TEST_RUN_NAMESPACE: namespace },
  stdio: "inherit",
  shell: process.platform === "win32",
};

if (needsPrismaGenerate) {
  const generate = spawnSync("pnpm", ["exec", "prisma", "generate"], spawnOptions);
  if (generate.error || generate.status !== 0) process.exit(generate.status ?? 1);
}

const result = spawnSync("pnpm", ["exec", "vitest", ...vitestArgs], spawnOptions);

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
