import { Prisma } from "@prisma/client";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import type { RelayChannelCredentialPresence } from "@/services/relay/relay-channel-configuration-projection";
import { iamAccountDenied } from "../users/iam-account-principal";
/** Convert only verified SQL booleans; malformed/raw credential values must never be accepted. */
function sqlBoolean(value: unknown): boolean {
  if (value === true || value === 1 || value === 1n) return true;
  if (value === false || value === 0 || value === 0n) return false;
  throw iamAccountDenied();
}
/** Call only for already admitted resources. Raw credentials never leave the database. */
export async function readRelayChannelCredentialPresence(tx: Prisma.TransactionClient, channelIds: readonly string[]) {
  if (new Set(channelIds).size !== channelIds.length || channelIds.some((id) => !/^[A-Za-z0-9_-]{1,128}$/.test(id)))
    throw iamAccountDenied();
  const result = new Map<string, RelayChannelCredentialPresence>(),
    limit = IAM_AUTHORIZATION_LIMITS.resourcesPerRequest;
  for (let offset = 0; offset < channelIds.length; offset += limit) {
    const ids = channelIds.slice(offset, offset + limit);
    const rows = await tx.$queryRaw<{ id: string; openai: unknown; anthropic: unknown; gemini: unknown }[]>(Prisma.sql`
      SELECT id, (openaiUpstreamApiKey IS NOT NULL AND OCTET_LENGTH(openaiUpstreamApiKey) > 0) AS openai,
        (anthropicUpstreamApiKey IS NOT NULL AND OCTET_LENGTH(anthropicUpstreamApiKey) > 0) AS anthropic,
        (geminiUpstreamApiKey IS NOT NULL AND OCTET_LENGTH(geminiUpstreamApiKey) > 0) AS gemini
      FROM relay_channels WHERE id IN (${Prisma.join(ids)}) ORDER BY id ASC`);
    if (
      rows.length !== ids.length ||
      new Set(rows.map((row) => row.id)).size !== ids.length ||
      rows.some((row) => !ids.includes(row.id))
    )
      throw iamAccountDenied();
    for (const row of rows)
      result.set(row.id, {
        hasOpenaiUpstreamApiKey: sqlBoolean(row.openai),
        hasAnthropicUpstreamApiKey: sqlBoolean(row.anthropic),
        hasGeminiUpstreamApiKey: sqlBoolean(row.gemini),
      });
  }
  return result;
}
