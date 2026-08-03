import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

const namespace = randomBytes(12).toString("hex");
const vitestArgs = process.argv.slice(2);
// Some pure services import Prisma-generated types without opening a database
// connection. Generate once for every invocation so a clean CI checkout can
// load those modules; database bootstrap remains database-project-only.
const needsPrismaGenerate = true;
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
