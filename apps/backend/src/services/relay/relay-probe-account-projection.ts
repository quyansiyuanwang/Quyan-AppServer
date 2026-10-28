import type { RelayProbeAccountPublicRecord } from "@/store/relay/platform-relay-probe-account-read.repository";
import type { RelayChannelProbeAccountDto } from "@/api/dto/relay/relay-channel-probe.dto";
export function projectRelayProbeAccount(
  account: Omit<RelayProbeAccountPublicRecord, "updateTime">,
  cached: boolean,
): RelayChannelProbeAccountDto {
  return {
    id: account.id,
    name: account.name,
    tokenPath: account.tokenPath,
    expiresPath: account.expiresPath ?? undefined,
    expiresMode: (account.expiresMode as "seconds" | "iso" | null) ?? undefined,
    fallbackTtlSeconds: account.fallbackTtlSeconds,
    minLoginIntervalSeconds: account.minLoginIntervalSeconds,
    lastLoginAttemptAt: account.lastLoginAttemptAt ?? undefined,
    nextLoginAt: account.lastLoginAttemptAt
      ? new Date(account.lastLoginAttemptAt.getTime() + account.minLoginIntervalSeconds * 1000)
      : undefined,
    cached,
    hasCredentials: account.hasCredentials,
  };
}
