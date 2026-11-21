import { isValidCredential, toCanonicalCredential, toLegacyCredential } from "@quyan/shared";
import type { Prisma } from "@prisma/client";

export type PlaintextCredentialType = "relayToken" | "accessKey" | "ojApiKey";

export function plaintextCredentialValues(value: string, type: PlaintextCredentialType): string[] {
  return isValidCredential(value, type) ? [toCanonicalCredential(value, type), toLegacyCredential(value, type)] : [];
}

export function relayCredentialWhere(values: string[]): Prisma.RelayTokenWhereInput {
  return { OR: [{ token: { in: values } }, { legacyToken: { in: values } }] };
}

export function keyCredentialWhere(values: string[]) {
  return { OR: [{ key: { in: values } }, { legacyKey: { in: values } }] };
}

/** SQL narrows by index; exact string comparison keeps the secret case-sensitive. */
export function findUniquePlaintextCredential<T>(
  rows: readonly T[],
  values: readonly string[],
  credentials: (row: T) => readonly (string | null)[],
): T | null {
  let match: T | null = null;
  for (const row of rows) {
    if (!credentials(row).some((value) => value !== null && values.includes(value))) continue;
    if (match !== null) return null;
    match = row;
  }
  return match;
}
