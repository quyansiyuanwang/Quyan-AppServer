import { redactDatabaseUrl, secretSummary } from "./common";
import type { EnvSnapshot } from "./source";

const secretKeys = [
  "JWT_ACCESS_SECRET",
  "JWT_REFRESH_SECRET",
  "REPLAY_SIGNING_MASTER_SECRET",
  "TWO_FACTOR_TRUSTED_DEVICE_SECRET",
  "DEVELOPER_SECRETS_MASTER_KEY",
  "RELAY_CHANNEL_PROBE_MASTER_KEY",
  "RELAY_CHANNEL_CHANGE_REQUEST_MASTER_KEY",
  "REDIS_PASSWORD",
  "ANTHROPIC_API_KEY",
] as const;

export function buildDiagnostics(source: EnvSnapshot) {
  const databaseUrl = source.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not defined in environment variables");

  return Object.freeze({
    nodeEnv: String(source.NODE_ENV || "unknown"),
    databaseUrl: redactDatabaseUrl(databaseUrl),
    secrets: Object.freeze(Object.fromEntries(secretKeys.map((key) => [key, secretSummary(source[key])]))),
  });
}
