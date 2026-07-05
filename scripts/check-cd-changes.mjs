import { execSync } from "child_process";

const APP_PATTERNS = {
  frontend: [/^apps\/frontend\//, /^packages\//],
  backend: [/^apps\/backend\//, /^packages\//],
  docs: [/^apps\/docs-site\//],
};

const app = process.argv[2];
if (!app || !APP_PATTERNS[app]) {
  console.error(`Usage: node scripts/check-cd-changes.mjs <${Object.keys(APP_PATTERNS).join("|")}>`);
  process.exit(2);
}

let changedFiles;
try {
  execSync("git rev-parse HEAD~1", { encoding: "utf8", stdio: "ignore" });
  changedFiles = execSync("git diff --name-only HEAD~1 HEAD", { encoding: "utf8" }).trim();
} catch {
  // HEAD~1 doesn't exist (initial commit or single-commit branch)
  changedFiles = execSync("git diff-tree --no-commit-id -r HEAD", { encoding: "utf8" }).trim();
}

const patterns = APP_PATTERNS[app];
const hasChanges = changedFiles
  .split("\n")
  .filter(Boolean)
  .some((file) => patterns.some((re) => re.test(file)));

process.exit(hasChanges ? 0 : 1);
