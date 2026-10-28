import { build } from "esbuild";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Explicit administrative artifact only: ordinary compile/deploy must not invoke this build.
const migrationDirectory = dirname(fileURLToPath(import.meta.url));
const backendDirectory = resolve(migrationDirectory, "../..");
const outfile = join(backendDirectory, ".tmp/migrations", basename(migrationDirectory), "runner.cjs");
await build({
  absWorkingDir: backendDirectory,
  entryPoints: [join(migrationDirectory, "run.ts")],
  outfile,
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  minify: true,
  sourcemap: false,
  external: ["@prisma/client", ".prisma/client", "sharp", "bcrypt", "jsonc-parser"],
  logLevel: "error",
});
console.log(`One-time IAM migration runner: ${outfile}`);
