import type { EnvSnapshot } from "./source";

const firstPartyHostPrefixes = [
  "www",
  "legacy",
  "auth",
  "account",
  "chat",
  "terminal",
  "ai.console",
  "developer.console",
  "ram.console",
  "kv.console",
  "short-link.console",
  "secret.console",
  "status.console",
  "verification.console",
  "ip-geolocation.console",
  "push.console",
  "oj.console",
  "management",
  "ai.management",
  "developer.management",
  "terminal.management",
] as const;

export function normalizeRootDomain(value: string | undefined): string | undefined {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");
  if (!normalized) return undefined;

  const labels = normalized.split(".");
  const isValid =
    normalized.length <= 253 &&
    labels.length >= 2 &&
    labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
  if (!isValid) throw new Error("ROOT_DOMAIN must be a hostname such as example.com");

  return normalized;
}

export function resolveRootDomain(source: EnvSnapshot, isProduction: boolean): string {
  const configuredDomain = normalizeRootDomain(source.ROOT_DOMAIN);
  if (configuredDomain) return configuredDomain;
  if (isProduction) throw new Error("ROOT_DOMAIN must be defined in production environment");

  return "qysyw.test";
}

/** Additional trusted deployment roots, expanded to exact first-party origins only. */
export function resolveTrustedRootDomains(source: EnvSnapshot, isProduction: boolean): string[] {
  const primaryRootDomain = resolveRootDomain(source, isProduction);
  const additionalRootDomains = String(source.ADDITIONAL_ROOT_DOMAINS || "")
    .split(",")
    .map((value) => normalizeRootDomain(value))
    .filter((value): value is string => Boolean(value));

  return [...new Set([primaryRootDomain, ...additionalRootDomains])];
}

export function buildFirstPartyOrigins(rootDomain: string, localPort?: string): string[] {
  return ["", ...firstPartyHostPrefixes].map((prefix) => {
    const port = localPort ? (prefix === "legacy" ? ":5174" : localPort) : "";
    const hostname = prefix ? `${prefix}.${rootDomain}` : rootDomain;
    return `https://${hostname}${port}`;
  });
}
