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

function normalizeRootDomain(value: string | undefined): string | undefined {
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

export function buildFirstPartyOrigins(rootDomain: string, localPort?: string): string[] {
  return firstPartyHostPrefixes.map((prefix) => {
    const port = localPort ? (prefix === "legacy" ? ":5174" : localPort) : "";
    return `https://${prefix}.${rootDomain}${port}`;
  });
}
