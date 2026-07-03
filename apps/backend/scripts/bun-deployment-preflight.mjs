import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const ecosystemConfigPath = path.resolve(projectRoot, "ecosystem.config.cjs");
const ecosystemConfig = require(ecosystemConfigPath);
const appConfig = ecosystemConfig?.apps?.find((app) => app?.name === "backend") || ecosystemConfig?.apps?.[0] || {};

const args = new Set(process.argv.slice(2));
const isHelp = args.has("--help") || args.has("-h");
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;

const requiredEnvKeys = [
  "NODE_ENV",
  "DATABASE_URL",
  "JWT_ACCESS_SECRET",
  "JWT_REFRESH_SECRET",
  "JWT_ACCESS_EXPIRES_IN",
  "JWT_REFRESH_EXPIRES_IN",
  "REPLAY_SIGNING_MASTER_SECRET",
  "REPLAY_SIGNING_SESSION_TTL_SECONDS",
];

function color(text, code) {
  if (!useColor) return text;
  return `\u001b[${code}m${text}\u001b[0m`;
}

function ok(text) {
  return color(text, "32");
}

function warn(text) {
  return color(text, "33");
}

function fail(text) {
  return color(text, "31");
}

function info(text) {
  return color(text, "36");
}

function printHelp() {
  console.log(`Bun deployment preflight checker

Usage:
  node ./scripts/bun-deployment-preflight.mjs

Purpose:
  Validate whether the current machine is ready to run NodeBackend with Bun + PM2.

Notes:
  - This script intentionally runs with Node so it can report a missing Bun binary cleanly.
  - Exit code 0 means all required checks passed.
  - Exit code 1 means at least one required check failed.
`);
}

function runCommand(command, commandArgs) {
  return execFileSync(command, commandArgs, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function commandExists(command, commandArgs = ["--version"]) {
  try {
    return {
      ok: true,
      output: runCommand(command, commandArgs),
    };
  } catch (error) {
    const message = error?.stderr?.toString?.().trim() || error?.message || "Unknown error";
    return {
      ok: false,
      output: message,
    };
  }
}

function resolveCommandPath(command) {
  const locator = process.platform === "win32" ? "where" : "which";
  const args = process.platform === "win32" ? [command] : [command];

  try {
    return runCommand(locator, args).split(/\r?\n/)[0]?.trim() || "unknown";
  } catch {
    return "unknown";
  }
}

function resolveEnvFilePath() {
  const raw = String(process.env.ENV_FILE_PATH || appConfig?.env_production?.ENV_FILE_PATH || "").trim();
  if (!raw) return "";
  return path.isAbsolute(raw) ? raw : path.resolve(projectRoot, raw);
}

function parseEnvFile(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const values = new Map();

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const normalized = line.startsWith("export ") ? line.slice(7).trim() : line;
    const separatorIndex = normalized.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = normalized.slice(0, separatorIndex).trim();
    const value = normalized.slice(separatorIndex + 1).trim();
    values.set(key, value);
  }

  return values;
}

function checkPm2Binary() {
  try {
    const pm2PackageJsonPath = require.resolve("pm2/package.json");
    const pm2PackageJson = JSON.parse(fs.readFileSync(pm2PackageJsonPath, "utf8"));

    return {
      ok: true,
      output: pm2PackageJson.version || "unknown",
      source: pm2PackageJsonPath,
    };
  } catch {
    // ignore and continue to global lookup
  }

  const localPm2Path = path.resolve(
    projectRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "pm2.cmd" : "pm2",
  );

  if (fs.existsSync(localPm2Path)) {
    try {
      return {
        ok: true,
        output: "local binary found",
        source: localPm2Path,
      };
    } catch (error) {
      return {
        ok: false,
        output: error?.stderr?.toString?.().trim() || error?.message || "Unknown error",
        source: localPm2Path,
      };
    }
  }

  const globalPm2 = commandExists("pm2", ["-v"]);
  return {
    ...globalPm2,
    source: globalPm2.ok ? resolveCommandPath("pm2") : "pm2",
  };
}

function report(status, title, detail) {
  const label = status === "pass" ? ok("PASS") : status === "warn" ? warn("WARN") : fail("FAIL");
  console.log(`${label} ${title}`);
  if (detail) console.log(`      ${detail}`);
}

if (isHelp) {
  printHelp();
  process.exit(0);
}

console.log(info("NodeBackend Bun + PM2 deployment preflight"));
console.log(`Project root: ${projectRoot}`);

let failed = 0;
let warned = 0;

const bunCheck = commandExists("bun", ["--version"]);
if (bunCheck.ok) {
  report("pass", `Bun available (${bunCheck.output})`, `Resolved path: ${resolveCommandPath("bun")}`);
} else {
  failed += 1;
  report("fail", "Bun not available for current user", bunCheck.output);
}

if (appConfig?.interpreter === "bun") {
  report("pass", 'PM2 interpreter is configured as "bun"', `Config file: ${ecosystemConfigPath}`);
} else {
  failed += 1;
  report("fail", "PM2 interpreter is not set to bun", `Current value: ${String(appConfig?.interpreter || "<empty>")}`);
}

const pm2Check = checkPm2Binary();
if (pm2Check.ok) {
  report("pass", `PM2 available (${pm2Check.output})`, `Resolved path: ${pm2Check.source}`);
} else {
  failed += 1;
  report("fail", "PM2 binary not available", pm2Check.output);
}

const appScript = String(appConfig?.script || "").trim();
const distFilePath = path.resolve(projectRoot, appScript || "./dist/index.cjs");
if (fs.existsSync(distFilePath)) {
  const stats = fs.statSync(distFilePath);
  report("pass", "Build artifact exists", `${distFilePath} (${stats.size} bytes)`);
} else {
  failed += 1;
  report("fail", "Build artifact missing", distFilePath);
}

const envFilePath = resolveEnvFilePath();
if (!envFilePath) {
  failed += 1;
  report("fail", "Production ENV_FILE_PATH is not configured", `Config file: ${ecosystemConfigPath}`);
} else if (path.basename(envFilePath) !== ".env") {
  failed += 1;
  report(
    "fail",
    'Production ENV_FILE_PATH basename must be ".env"',
    `Current value: ${envFilePath}`,
  );
} else if (!fs.existsSync(envFilePath)) {
  failed += 1;
  report("fail", "Production env file missing", envFilePath);
} else {
  report("pass", "Production env file exists", envFilePath);

  const envValues = parseEnvFile(envFilePath);
  const missingKeys = requiredEnvKeys.filter((key) => {
    const rawValue = envValues.get(key);
    return !String(rawValue || "").trim();
  });

  if (missingKeys.length === 0) {
    report("pass", "Required production env keys exist", requiredEnvKeys.join(", "));
  } else {
    failed += 1;
    report("fail", "Required production env keys missing", missingKeys.join(", "));
  }

  const nodeEnvValue = String(envValues.get("NODE_ENV") || "").trim();
  if (nodeEnvValue === "production") {
    report("pass", 'NODE_ENV is set to "production" in env file');
  } else {
    warned += 1;
    report("warn", 'NODE_ENV is not "production" in env file', `Current value: ${nodeEnvValue || "<empty>"}`);
  }
}

if (appConfig?.wait_ready === true) {
  report("pass", "PM2 wait_ready enabled", `listen_timeout=${String(appConfig?.listen_timeout || "<empty>")}`);
} else {
  warned += 1;
  report("warn", "PM2 wait_ready is disabled", "Current config is less strict for graceful readiness");
}

if (appConfig?.exec_mode === "cluster") {
  report("pass", "PM2 cluster mode enabled", `instances=${String(appConfig?.instances || "<empty>")}`);
} else {
  warned += 1;
  report("warn", "PM2 is not using cluster mode", `Current exec_mode: ${String(appConfig?.exec_mode || "<empty>")}`);
}

console.log("");
if (failed > 0) {
  console.log(fail(`Preflight failed: ${failed} required check(s) failed, ${warned} warning(s).`));
  process.exit(1);
}

console.log(ok(`Preflight passed: 0 required failures, ${warned} warning(s).`));