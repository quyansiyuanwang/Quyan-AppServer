import { access, readFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const cwd = process.cwd();
const schemaPath = path.resolve(cwd, "prisma/schema.prisma");
const generatedSchemaPath = path.resolve(cwd, "node_modules/.prisma/client/schema.prisma");
const generatedIndexPath = path.resolve(cwd, "node_modules/.prisma/client/index.d.ts");
const generatedEnginePath = path.resolve(cwd, "node_modules/.prisma/client/query_engine-windows.dll.node");

async function shouldGeneratePrismaClient() {
  try {
    await Promise.all([access(generatedSchemaPath), access(generatedIndexPath)]);
  } catch {
    return true;
  }

  const [schemaContents, generatedSchemaContents] = await Promise.all([
    readFile(schemaPath, "utf8"),
    readFile(generatedSchemaPath, "utf8"),
  ]);

  return schemaContents !== generatedSchemaContents;
}

async function main() {
  const shouldGenerate = await shouldGeneratePrismaClient();

  if (!shouldGenerate) {
    console.log("✓ Prisma Client already up to date");
    return;
  }

  let generateArgs = ["exec", "prisma", "generate"];

  try {
    await access(generatedEnginePath);
    generateArgs = ["exec", "prisma", "generate", "--no-engine"];
  } catch {
    generateArgs = ["exec", "prisma", "generate"];
  }

  console.log(
    `Prisma schema changed; generating Prisma Client (${generateArgs.includes("--no-engine") ? "no-engine" : "full"})...`,
  );

  const command =
    process.platform === "win32" ? `pnpm.cmd ${generateArgs.join(" ")}` : `pnpm ${generateArgs.join(" ")}`;

  execSync(command, {
    cwd,
    stdio: "inherit",
  });
}

await main();
