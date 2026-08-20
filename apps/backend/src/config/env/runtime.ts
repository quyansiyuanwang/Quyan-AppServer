import { sanitizeInt } from "./common";
import { buildFirstPartyOrigins, resolveRootDomain, resolveTrustedRootDomains } from "./domain";
import type { EnvSnapshot } from "./source";

export function buildRuntimeConfig(source: EnvSnapshot) {
  const nodeEnv = String(source.NODE_ENV || "unknown");
  const port = source.PORT;
  if (!port) throw new Error("PORT is not defined in environment variables");

  const trustProxyRaw = String(source.TRUST_PROXY_HOPS || "1").trim();
  if (!/^\d+$/.test(trustProxyRaw)) throw new Error("TRUST_PROXY_HOPS must be an integer between 0 and 10");
  const trustProxyHops = Number(trustProxyRaw);
  if (trustProxyHops < 0 || trustProxyHops > 10)
    throw new Error("TRUST_PROXY_HOPS must be an integer between 0 and 10");

  const isProduction = nodeEnv === "production";
  const rootDomain = resolveRootDomain(source, isProduction);
  const trustedRootDomains = resolveTrustedRootDomains(source, isProduction);
  const configuredCorsAllowedOrigins = String(source.CORS_ALLOWED_ORIGINS || "").trim();
  const corsAllowedOrigins =
    configuredCorsAllowedOrigins ||
    trustedRootDomains
      .flatMap((domain) => buildFirstPartyOrigins(domain, isProduction ? undefined : ":5173"))
      .join(",");
  if (
    corsAllowedOrigins
      .split(",")
      .map((origin) => origin.trim())
      .some((origin) => origin.includes("*") || origin.startsWith("regex:"))
  )
    throw new Error("CORS_ALLOWED_ORIGINS only supports exact origins");

  return {
    isProduction,
    isDevelopment: nodeEnv === "development",
    isTest: nodeEnv === "test",
    nodeEnv,
    agentRuntimeLocal: source.AGENT_RUNTIME_LOCAL === "true",
    rootDomain,
    trustedRootDomains,
    port: Number.parseInt(port, 10),
    trustProxyHops,
    corsAllowedOrigins,
    cwd: process.cwd(),
    logging: {
      disableConsoleLog: source.DISABLE_CONSOLE_LOG === "true",
      enableFileLogging: source.ENABLE_FILE_LOGGING === "true",
    },
    requestSizeLimits: {
      jsonBodyLimitMb: sanitizeInt(source.REQUEST_JSON_BODY_LIMIT_MB, 5, 1, 100),
      urlencodedBodyLimitMb: sanitizeInt(source.REQUEST_URLENCODED_BODY_LIMIT_MB, 2, 1, 100),
      otherBodyLimitMb: sanitizeInt(source.REQUEST_OTHER_BODY_LIMIT_MB, 10, 1, 100),
      archiveImportBodyLimitMb: sanitizeInt(source.DATA_MAINTENANCE_IMPORT_MAX_MB, 100, 1, 512),
    },
  };
}
