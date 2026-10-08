import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { Project } from "ts-morph";
import { collectIamRoutes, isJwtRoute, routeCoverageRegressions, summarizeIamRoutes } from "./route-inventory";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const repoRoot = path.resolve(backendRoot, "../..");
function controllerGlobs(text: string): string[] {
  const config = JSON.parse(text) as { controllerPathGlobs?: unknown };
  if (
    !Array.isArray(config.controllerPathGlobs) ||
    !config.controllerPathGlobs.length ||
    config.controllerPathGlobs.some(
      (value) => typeof value !== "string" || path.isAbsolute(value) || value.split("/").includes(".."),
    )
  )
    throw new Error("Invalid controllerPathGlobs in tsoa.json");
  return config.controllerPathGlobs;
}
function currentInventory() {
  const project = new Project({ skipAddingFilesFromTsConfig: true });
  const sources = project.addSourceFilesAtPaths(
    controllerGlobs(fs.readFileSync(path.join(backendRoot, "tsoa.json"), "utf8")).map((glob) =>
      path.join(backendRoot, glob),
    ),
  );
  return collectIamRoutes(sources, backendRoot);
}
function baseInventory(ref: string) {
  if (!/^[A-Za-z0-9_./-]+$/.test(ref) || ref.startsWith("-")) throw new Error("Invalid base ref");
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  const sha = git("rev-parse", "--verify", ref + "^{commit}").trim();
  const globs = controllerGlobs(git("show", sha + ":apps/backend/tsoa.json"));
  const project = new Project({ useInMemoryFileSystem: true });
  const virtualRoot = "/backend";
  // Use the actual base-commit TSOA globs, including renamed/deleted controllers.
  for (const filename of git("ls-tree", "-rz", "--name-only", sha, "--", "apps/backend").split("\0").filter(Boolean)) {
    if (filename.endsWith(".ts"))
      project.getFileSystem().writeFileSync(virtualRoot + "/" + filename.slice("apps/backend/".length), "");
  }
  const filenames = project.getFileSystem().globSync(globs.map((glob) => virtualRoot + "/" + glob));
  const sources = filenames.map((filename) =>
    project.createSourceFile(
      filename,
      git("show", sha + ":apps/backend/" + filename.slice((virtualRoot + "/").length)),
      { overwrite: true },
    ),
  );
  return collectIamRoutes(sources, virtualRoot);
}
function run() {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((value, index) => !(index === 0 && value === "--")),
    options: {
      json: { type: "boolean" },
      check: { type: "boolean" },
      "require-complete": { type: "boolean" },
      "base-ref": { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });
  if (values.check && !values["base-ref"]) throw new Error("--check requires an explicit --base-ref");
  const entries = currentInventory();
  const failures = values.check
    ? routeCoverageRegressions(entries, baseInventory(values["base-ref"]!))
    : entries.flatMap((entry) => entry.issues.map((issue) => entry.key + ": " + issue));
  if (values["require-complete"])
    for (const entry of entries.filter(isJwtRoute))
      if (entry.coverage !== "explicit")
        failures.push(entry.key + ": explicit IAM metadata required for complete rollout");
  if (values.json)
    console.log(JSON.stringify({ summary: summarizeIamRoutes(entries), routes: entries, failures }, null, 2));
  else {
    console.log("IAM route inventory", summarizeIamRoutes(entries));
    for (const failure of failures) console.error(failure);
  }
  if (failures.length) process.exitCode = 1;
}
try {
  run();
} catch (error) {
  console.error("[iam-route-audit] " + (error instanceof Error ? error.message : "Unable to audit routes"));
  process.exitCode = 1;
}
