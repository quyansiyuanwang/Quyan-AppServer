import { DEVELOPER_PRODUCTS } from "@quyan/shared";
import type { EnvSnapshot } from "./source";

/**
 * First-party hosts that are not developer products. The public site is served
 * from the bare root domain and is therefore not part of this list.
 */
const platformHostPrefixes = [
  "www",
  "legacy",
  "auth",
  "account",
  "chat",
  "terminal",
  "ai.console",
  "developer.console",
  "ram.console",
  "oj.console",
  "management",
  "ai.management",
  "developer.management",
  "terminal.management",
] as const;

/**
 * Product consoles derive from the shared product catalog so a new developer
 * product cannot be registered without its trusted first-party origins.
 */
const productHostPrefixes = DEVELOPER_PRODUCTS.map((product) => `${product.urlSlug}.console`);

export const firstPartyHostPrefixes = [...platformHostPrefixes, ...productHostPrefixes] as const;

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
