import { isIP } from "node:net";
import { normalizeIp } from "@/util/ip-extractor";

const IP_WHITELIST_SEPARATOR_REGEX = /[\r\n,;]+/;

export const splitIpWhitelistEntries = (value?: string | null): string[] => {
  if (!value) return [];

  return value
    .split(IP_WHITELIST_SEPARATOR_REGEX)
    .map((entry) => entry.trim())
    .filter(Boolean);
};

export const isValidIpWhitelistEntry = (value: string): boolean => {
  const normalizedValue = normalizeIp(value.trim());
  return isIP(normalizedValue) !== 0;
};

export const normalizeIpWhitelistEntries = (value?: string | null): string[] => {
  const uniqueEntries = new Set<string>();

  for (const entry of splitIpWhitelistEntries(value)) {
    const normalizedEntry = normalizeIp(entry);
    if (!normalizedEntry || uniqueEntries.has(normalizedEntry)) continue;
    uniqueEntries.add(normalizedEntry);
  }

  return Array.from(uniqueEntries);
};

export const normalizeIpWhitelist = (value?: string | null): string | undefined => {
  const normalizedEntries = normalizeIpWhitelistEntries(value);
  return normalizedEntries.length ? normalizedEntries.join("\n") : undefined;
};

export const isIpWhitelisted = (clientIp: string, whitelist?: string | null): boolean => {
  const normalizedEntries = normalizeIpWhitelistEntries(whitelist);
  if (normalizedEntries.length === 0) return true;

  const normalizedClientIp = normalizeIp(clientIp.trim());
  if (!normalizedClientIp || !isValidIpWhitelistEntry(normalizedClientIp)) return false;

  return normalizedEntries.includes(normalizedClientIp);
};
