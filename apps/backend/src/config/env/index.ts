import { buildAuthConfig } from "./auth";
import { deepFreeze } from "./common";
import { buildDatabaseConfig } from "./database";
import { buildDiagnostics } from "./diagnostics";
import { buildIntegrationsConfig, buildRateLimitConfig, buildRedisConfig, buildRelayConfig } from "./infrastructure";
import { buildRuntimeConfig } from "./runtime";
import { buildSecurityConfig } from "./security";
import { assertNotRunningFromDist, EnvironmentSource, type EnvSnapshot } from "./source";
import { assertEnvironment } from "./validators";

assertNotRunningFromDist();

const environmentSource = new EnvironmentSource();
let envSnapshot: EnvSnapshot = new Proxy({} as EnvSnapshot, {
  get: (_target, key) => (typeof key === "string" ? environmentSource.read(key) : undefined),
});

assertEnvironment(envSnapshot);

const runtime = buildRuntimeConfig(envSnapshot);
const resolvedEnvironment = {
  runtime,
  database: buildDatabaseConfig(envSnapshot),
  auth: buildAuthConfig(envSnapshot, runtime),
  security: buildSecurityConfig(envSnapshot),
  redis: buildRedisConfig(envSnapshot),
  rateLimit: buildRateLimitConfig(envSnapshot),
  relay: buildRelayConfig(envSnapshot),
  integrations: buildIntegrationsConfig(envSnapshot),
  diagnostics: buildDiagnostics(envSnapshot),
};

// Runtime configuration is immutable. The test runner uses a private process
// and intentionally adjusts the resolved object to model individual settings.
export const env = (runtime.isTest ? resolvedEnvironment : deepFreeze(resolvedEnvironment)) as Readonly<
  typeof resolvedEnvironment
>;

export type Environment = typeof env;

export function createEnvironmentForTests(overrides: Partial<Environment>): Environment {
  return deepFreeze({ ...structuredClone(env), ...overrides }) as Environment;
}

environmentSource.dispose();
envSnapshot = Object.freeze({});
