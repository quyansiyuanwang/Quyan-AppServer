import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const testsRoot = path.resolve(process.cwd(), "tests");
const rules = [
  { directory: "unit", suffix: ".unit.test.ts" },
  { directory: "database", suffix: ".db.test.ts" },
  { directory: "integration", suffix: ".integration.test.ts" },
  { directory: "contract", suffix: ".contract.test.ts" },
];

async function filesIn(directory) {
  const absolute = path.join(testsRoot, directory);
  const entries = await readdir(absolute, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(absolute, entry.name);
      return entry.isDirectory() ? filesIn(path.relative(testsRoot, target)) : [target];
    }),
  );
  return files.flat();
}

const errors = [];
for (const rule of rules) {
  for (const file of await filesIn(rule.directory)) {
    if (!file.endsWith(".test.ts")) continue;
    const relative = path.relative(testsRoot, file).replaceAll("\\", "/");
    if (!relative.endsWith(rule.suffix)) errors.push(`${relative} must end with ${rule.suffix}`);

    if (rule.directory === "unit") {
      const content = await readFile(file, "utf8");
      if (/^import\s+.*(?:@\/config\/database|\.\.\/.*\/src\/config\/database)/mu.test(content))
        errors.push(`${relative} imports the Prisma runtime and belongs in tests/database`);
    }
  }
}

if (errors.length > 0) {
  console.error("Test taxonomy validation failed:\n" + errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

console.log("Test taxonomy is valid.");
