import fs from "fs";
import path from "path";
import dotenv from "dotenv";

export type EnvSnapshot = Readonly<Record<string, string | undefined>>;

function getExplicitEnvPath(): string | undefined {
  const raw = String(process.env.ENV_FILE_PATH || "").trim();
  return raw || undefined;
}

export function assertNotRunningFromDist(): void {
  if (path.basename(process.cwd()) === "dist")
    throw new Error(
      "Backend must not be started with process.cwd() inside dist. Start from the app root or configure PM2 cwd to the app root.",
    );
}

function resolveEnvPath(fileName: string): string {
  const explicitEnvPath = getExplicitEnvPath();
  if (explicitEnvPath && path.basename(explicitEnvPath) === fileName && fs.existsSync(explicitEnvPath))
    return explicitEnvPath;

  const candidate = path.join(process.cwd(), fileName);
  return fs.existsSync(candidate) ? candidate : fileName;
}

function parseEnvFile(filePath: string): Record<string, string | undefined> {
  if (!fs.existsSync(filePath)) return {};
  return dotenv.parse(fs.readFileSync(filePath));
}

export class EnvironmentSource {
  private readonly baseValues = parseEnvFile(resolveEnvPath(".env"));
  private readonly nodeEnv = process.env.NODE_ENV || this.baseValues.NODE_ENV;
  private readonly testValues = this.nodeEnv === "test" ? parseEnvFile(resolveEnvPath(".env.test")) : {};
  private readonly resolvedValues = new Map<string, string | undefined>();

  read(key: string): string | undefined {
    if (this.resolvedValues.has(key)) return this.resolvedValues.get(key);

    let value: string | undefined;
    if (this.nodeEnv === "test" && key === "DATABASE_URL" && process.env.APPSERVER_TEST_DATABASE_URL)
      value = process.env.APPSERVER_TEST_DATABASE_URL;
    else if (this.nodeEnv === "test" && key === "REDIS_DB" && process.env.APPSERVER_TEST_REDIS_DB)
      value = process.env.APPSERVER_TEST_REDIS_DB;
    else if (this.nodeEnv === "test" && key in this.testValues) value = this.testValues[key];
    else value = process.env[key] ?? this.baseValues[key];

    this.resolvedValues.set(key, value);
    return value;
  }

  dispose(): void {
    this.resolvedValues.clear();
    Object.keys(this.baseValues).forEach((key) => delete this.baseValues[key]);
    Object.keys(this.testValues).forEach((key) => delete this.testValues[key]);
  }
}
