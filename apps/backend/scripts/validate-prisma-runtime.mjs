import { readFileSync, realpathSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Validate only deployed files; never fall back to a parent node_modules. */
export function validatePrismaRuntime(root, { targetRuntime = false } = {}) {
  const modules = path.join(root, "dist/node_modules");
  const wrapper = path.join(modules, "@prisma/client");
  const generated = path.join(modules, ".prisma/client");
  const require = createRequire(path.join(wrapper, "package.json"));
  const within = (file) => {
    const relative = path.relative(realpathSync(modules), realpathSync(file));
    if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
      throw new Error("Prisma resolution escaped the deployment artifact");
    }
  };
  for (const file of [path.join(wrapper, "package.json"), path.join(generated, "schema.prisma")]) within(file);
  const normalizeSchema = (schema) => schema.replace(/\s+/g, "");
  if (
    normalizeSchema(readFileSync(path.join(root, "prisma/schema.prisma"), "utf8")) !==
    normalizeSchema(readFileSync(path.join(generated, "schema.prisma"), "utf8"))
  ) {
    throw new Error("Generated Prisma schema does not match the release schema");
  }
  const entry = require.resolve(wrapper);
  const generatedEntry = require.resolve(".prisma/client/default");
  within(entry);
  within(generatedEntry);
  const { PrismaClient, Prisma } = require(entry);
  const { version } = require(path.join(wrapper, "package.json"));
  if (typeof PrismaClient !== "function" || Prisma?.prismaVersion?.client !== version) {
    throw new Error("Prisma Client is missing or its version does not match the runtime package");
  }
  // Construction validates the generated client without connecting to the database.
  new PrismaClient();
  if (targetRuntime) {
    if (
      process.platform !== "linux" ||
      process.arch !== "x64" ||
      !process.report.getReport().header.glibcVersionRuntime
    ) {
      throw new Error("Deployment requires x86_64 glibc Linux");
    }
    const engine = path.join(generated, "libquery_engine-debian-openssl-3.0.x.so.node");
    within(engine);
    if (!statSync(engine).isFile() || !statSync(engine).size) throw new Error("Prisma Query Engine is empty");
    const linkage = execFileSync("ldd", [engine], { encoding: "utf8" });
    if (/not found/i.test(linkage)) {
      throw new Error(`Prisma Query Engine has unresolved shared libraries: ${linkage}`);
    }
    const opensslVersion = execFileSync("openssl", ["version"], { encoding: "utf8" }).trim();
    if (!/^OpenSSL 3\./.test(opensslVersion)) {
      throw new Error(`Prisma deployment requires OpenSSL 3.x, found: ${opensslVersion}`);
    }
  }
  return { version };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const result = validatePrismaRuntime(root, { targetRuntime: process.argv.includes("--target-runtime") });
    console.log(`[deploy] Prisma runtime validated (${result.version}); no generation or database connection`);
  } catch (error) {
    console.error(`[deploy] Prisma runtime validation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
