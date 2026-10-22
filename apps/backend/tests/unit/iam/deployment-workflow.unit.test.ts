import { readFileSync, mkdtempSync, writeFileSync, rmSync, chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
const script = path.resolve("scripts/deploy-iam.sh");
const gitPaths =
  process.platform === "win32"
    ? spawnSync("where.exe", ["git"], { encoding: "utf8", windowsHide: true }).stdout.trim().split(/\r?\n/)
    : [];
const bash =
  process.platform === "win32"
    ? (gitPaths.map((git) => path.resolve(path.dirname(git), "../bin/bash.exe")).find(existsSync) ?? "")
    : "bash";
if (!bash) throw new Error("Git Bash is required for the deployment shell regression tests");
function run(failure: "none" | "preflight" | "stop" | "apply") {
  const dir = mkdtempSync(path.join(tmpdir(), "quyan-iam-deploy-"));
  try {
    const log = path.join(dir, "commands.log");
    for (const name of ["bun", "pm2"]) {
      const file = path.join(dir, name);
      writeFileSync(
        file,
        `#!/usr/bin/env bash
set -euo pipefail
if [[ "${name}" == "pm2" ]]; then stage=stop
elif [[ "$*" == *"--apply"* ]]; then stage=apply
else stage=preflight; fi
printf '%s\n' "$stage" >> "$IAM_TEST_LOG"
if [[ "$stage" == "$IAM_TEST_FAILURE" ]]; then exit 23; fi
`,
      );
      chmodSync(file, 0o700);
    }
    const result = spawnSync(bash, [script], {
      env: {
        ...process.env,
        PATH: dir + path.delimiter + process.env.PATH,
        IAM_TEST_LOG: log.replaceAll("\\", "/"),
        IAM_TEST_FAILURE: failure,
      },
      encoding: "utf8",
      windowsHide: true,
    });
    if (result.error) throw result.error;
    return { status: result.status, commands: readFileSync(log, "utf8").trim().split("\n") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
describe("opt-in deployment IAM maintenance gate", () => {
  it("runs read-only preflight before stopping the backend and applying", () => {
    expect(run("none")).toEqual({ status: 0, commands: ["preflight", "stop", "apply"] });
  });
  it.each(["preflight", "stop", "apply"] as const)(
    "fails closed at %s without running subsequent commands",
    (failure) => {
      const commands = ["preflight", "stop", "apply"];
      expect(run(failure)).toEqual({ status: 23, commands: commands.slice(0, commands.indexOf(failure) + 1) });
    },
  );
  it("ships the runner and resolves the JSON parser through production dependencies", () => {
    const build = readFileSync(path.resolve("esbuild.config.mjs"), "utf8");
    const metadata = JSON.parse(readFileSync(path.resolve("package.json"), "utf8"));
    expect(build).toContain('outfile: "./dist/iam-migrate.cjs"');
    expect(build).toContain('external: ["@prisma/client", ".prisma/client", "sharp", "bcrypt", "jsonc-parser"]');
    expect(metadata.dependencies["jsonc-parser"]).toBeTruthy();
    expect(metadata.scripts.compile).toBe("node esbuild.config.mjs");
  });
  it("requires backup confirmation and runs the opt-in gate between SQL migrations and reload", () => {
    const workflow = readFileSync(path.resolve("../../.github/workflows/deploy.yml"), "utf8");
    expect(workflow).toContain("inputs.iam-migration && !inputs.iam-backup-confirmed");
    expect(workflow).toContain("if: ${{ inputs.iam-migration }}");
    expect(workflow.indexOf("name: Validate IAM migration confirmation")).toBeLessThan(
      workflow.indexOf("name: Deploy backend"),
    );
    expect(workflow.indexOf("name: Run database migrations")).toBeLessThan(
      workflow.indexOf("name: Migrate legacy IAM data and verify"),
    );
    expect(workflow.indexOf("name: Migrate legacy IAM data and verify")).toBeLessThan(
      workflow.indexOf("name: Reload PM2"),
    );
    expect(workflow).toContain('test -s "$bundle_dir/dist/iam-migrate.cjs"');
    expect(workflow).toContain('test -s "$bundle_dir/scripts/deploy-iam.sh"');
    expect(readFileSync(script, "utf8")).not.toContain("IAM_AUTHORIZATION_MODE=");
  });
});
