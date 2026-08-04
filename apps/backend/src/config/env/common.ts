import { createHash } from "crypto";

export type CookieSameSite = "strict" | "lax" | "none";

export function sanitizeInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function normalizeCookieSameSite(value: string | undefined, fallback: CookieSameSite): CookieSameSite {
  const normalized = String(value || fallback)
    .trim()
    .toLowerCase();
  return normalized === "lax" || normalized === "none" ? normalized : "strict";
}

export function redactDatabaseUrl(value: string): string {
  return value.replace(/(\/\/[^:]+:)[^@]+@/, "$1****@");
}

export function secretSummary(value: string | undefined): string {
  const normalized = String(value || "").trim();
  if (!normalized) return "<unset>";
  const fingerprint = createHash("sha256").update(normalized).digest("hex").slice(0, 12);
  return `<configured:${normalized.length} chars, fingerprint:${fingerprint}>`;
}

export function deepFreeze<T>(value: T): Readonly<T> {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value as Readonly<T>;
  Object.values(value).forEach((child) => deepFreeze(child));
  return Object.freeze(value);
}
