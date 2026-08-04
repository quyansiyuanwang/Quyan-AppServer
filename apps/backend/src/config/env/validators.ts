import { redactDatabaseUrl, secretSummary } from "./common";
import { AssertionCenter } from "./assertions";
import type { EnvSnapshot } from "./source";

export function assertEnvironment(source: EnvSnapshot): void {
  const assertions = new AssertionCenter();
  assertions.register(() => assertTestModeDatabaseSafety(source));
  assertions.register(() => assertTrustedDeviceSecretIsolation(source));
  assertions.register(() => assertReplaySigningSecretIsolation(source));
  assertions.register(() => assertDeveloperSecretsMasterKey(source));
  assertions.register(() => assertRelayChannelProbeMasterKey(source));
  assertions.assert();
}

function assertTestModeDatabaseSafety(source: EnvSnapshot): void {
  if (source.NODE_ENV !== "test") return;
  const databaseUrl = source.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not defined in test environment variables");
  const normalized = databaseUrl.toLowerCase();
  const isTestDatabase =
    normalized.includes("_test") ||
    normalized.includes("-test") ||
    normalized.endsWith("test") ||
    normalized.includes("/test");
  if (!isTestDatabase)
    throw new Error(
      `Unsafe test database configuration detected: ${redactDatabaseUrl(databaseUrl)}. NODE_ENV=test must use a dedicated test database.`,
    );
}

function assertTrustedDeviceSecretIsolation(source: EnvSnapshot): void {
  const trustedDeviceSecret = String(source.TWO_FACTOR_TRUSTED_DEVICE_SECRET || "").trim();
  if (trustedDeviceSecret && trustedDeviceSecret.length < 64)
    throw new Error("TWO_FACTOR_TRUSTED_DEVICE_SECRET must be at least 64 characters");
  if (trustedDeviceSecret && trustedDeviceSecret === String(source.JWT_ACCESS_SECRET || "").trim())
    throw new Error("TWO_FACTOR_TRUSTED_DEVICE_SECRET must be different from JWT_ACCESS_SECRET");
}

function assertReplaySigningSecretIsolation(source: EnvSnapshot): void {
  const secret = String(source.REPLAY_SIGNING_MASTER_SECRET || "").trim();
  if (!secret) throw new Error("REPLAY_SIGNING_MASTER_SECRET is not defined in environment variables");
  if (secret.length < 64) throw new Error("REPLAY_SIGNING_MASTER_SECRET must be at least 64 characters");
  const protectedSecrets = [
    source.JWT_ACCESS_SECRET,
    source.JWT_REFRESH_SECRET,
    source.TWO_FACTOR_TRUSTED_DEVICE_SECRET,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  if (protectedSecrets.includes(secret))
    throw new Error("REPLAY_SIGNING_MASTER_SECRET must be different from JWT and trusted device secrets");
}

function assertDeveloperSecretsMasterKey(source: EnvSnapshot): void {
  const secret = String(source.DEVELOPER_SECRETS_MASTER_KEY || "").trim();
  if (!secret) return;
  if (secret.length < 64)
    throw new Error(`DEVELOPER_SECRETS_MASTER_KEY must be at least 64 characters (${secretSummary(secret)})`);
  const protectedSecrets = [
    source.JWT_ACCESS_SECRET,
    source.JWT_REFRESH_SECRET,
    source.REPLAY_SIGNING_MASTER_SECRET,
    source.TWO_FACTOR_TRUSTED_DEVICE_SECRET,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  if (protectedSecrets.includes(secret))
    throw new Error("DEVELOPER_SECRETS_MASTER_KEY must be different from authentication and replay secrets");
}

function assertRelayChannelProbeMasterKey(source: EnvSnapshot): void {
  const secret = String(source.RELAY_CHANNEL_PROBE_MASTER_KEY || "").trim();
  if (!secret) return;
  if (secret.length < 64) throw new Error("RELAY_CHANNEL_PROBE_MASTER_KEY must be at least 64 characters");
  const protectedSecrets = [
    source.JWT_ACCESS_SECRET,
    source.JWT_REFRESH_SECRET,
    source.REPLAY_SIGNING_MASTER_SECRET,
    source.TWO_FACTOR_TRUSTED_DEVICE_SECRET,
    source.DEVELOPER_SECRETS_MASTER_KEY,
  ].map((value) => String(value || "").trim());
  if (protectedSecrets.includes(secret))
    throw new Error("RELAY_CHANNEL_PROBE_MASTER_KEY must be different from authentication and platform secrets");
}
