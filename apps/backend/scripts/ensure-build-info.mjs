import { existsSync, mkdirSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const outFile = resolve(root, "src/generated/buildInfo.ts");

if (!existsSync(outFile)) {
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(
    outFile,
    `// Auto-generated fallback for type-check/CI — DO NOT EDIT
export const BUILD_INFO = {
  version: "unknown",
  commitHash: "unknown",
  commitHashShort: "unknown",
  branch: "unknown",
  commitMessage: "unknown",
  commitTime: "unknown",
  buildTime: "unknown",
} as const;
`,
    "utf8",
  );
  console.log("✓ Created fallback src/generated/buildInfo.ts");
} else {
  console.log("✓ Existing src/generated/buildInfo.ts detected");
}
