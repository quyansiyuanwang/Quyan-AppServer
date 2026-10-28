import { RELAY_CHANNEL_STATUS } from "@/constant/relay-channel";
import type { RelayChannel } from "@prisma/client";
import type { RelayChannelExportItemDto, RelayChannelMemberDto } from "@/api/dto/relay/relay-channel.dto";
import { relayChannelExportConfigurationSchema } from "@/api/schema/relay/relay-channel.schema";
import {
  MAX_RETRY_STATUS_RULES,
  matchesRetryStatusRule,
  projectPublicRetryStatusRules,
} from "@/util/relay/relay-failover-status-rule.util";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
export type RelayChannelExportSource = Pick<
  RelayChannel,
  | "id"
  | "name"
  | "status"
  | "channelType"
  | "routingStrategy"
  | "routingConfig"
  | "visibilityMode"
  | "visibilityConfig"
  | "pooledParentId"
  | "pooledPriority"
  | "pooledWeight"
  | "pooledMemberEnabled"
  | "useProxy"
  | "multiplier"
  | "allowedFormats"
  | "allowedModels"
  | "addUserIdentifier"
  | "inputTokensIncludeCacheRead"
  | "modelMapping"
  | "timePeriodMultipliers"
  | "contextLengthMultipliers"
  | "createTime"
  | "updateTime"
>;
/** Explicit source fields + schema strip unknown nested keys. Never spread a database row into a portable DTO. */
export function projectRelayChannelExport(
  source: RelayChannelExportSource,
  poolMembers: RelayChannelMemberDto[],
): RelayChannelExportItemDto {
  const routing =
    source.routingConfig && typeof source.routingConfig === "object" && !Array.isArray(source.routingConfig)
      ? { ...source.routingConfig }
      : source.routingConfig;
  if (routing && typeof routing === "object" && !Array.isArray(routing) && "retryStatusCodes" in routing) {
    const retryStatusCodes = projectPublicRetryStatusRules(routing.retryStatusCodes);
    if (!retryStatusCodes) throw iamAccountDenied();
    // Keep portable output within the same rule-count limit after a regex expands to many codes.
    // This canonical expression is generated only from matching three-digit codes, never copied from private input.
    if (retryStatusCodes.length > MAX_RETRY_STATUS_RULES) {
      const groups = new Map<string, string[]>();
      for (let code = 100; code <= 599; code++) {
        if (!retryStatusCodes.some((rule) => matchesRetryStatusRule(code, rule))) continue;
        const text = String(code),
          prefix = text.slice(0, 2),
          digits = groups.get(prefix) ?? [];
        digits.push(text[2]!);
        groups.set(prefix, digits);
      }
      routing.retryStatusCodes = [
        "/^(?:" +
          [...groups]
            .map(([prefix, digits]) => prefix + (digits.length === 1 ? digits[0] : "[" + digits.join("") + "]"))
            .join("|") +
          ")$/",
      ];
    } else routing.retryStatusCodes = retryStatusCodes;
  }
  const parsed = relayChannelExportConfigurationSchema.safeParse({
    name: source.name,
    channelType: source.channelType,
    routingStrategy: source.routingStrategy,
    routingConfig: routing,
    visibilityMode: source.visibilityMode,
    visibilityConfig: source.visibilityConfig,
    pooledParentId: source.pooledParentId,
    pooledPriority: source.pooledPriority,
    pooledWeight: source.pooledWeight == null ? undefined : Number(source.pooledWeight),
    pooledMemberEnabled: source.pooledMemberEnabled,
    poolMembers,
    useProxy: source.useProxy,
    multiplier: Number(source.multiplier),
    allowedFormats: source.allowedFormats ?? undefined,
    allowedModels: source.allowedModels,
    addUserIdentifier: source.addUserIdentifier,
    inputTokensIncludeCacheRead: source.inputTokensIncludeCacheRead,
    modelMapping: source.modelMapping,
    timePeriodMultipliers: source.timePeriodMultipliers,
    contextLengthMultipliers: source.contextLengthMultipliers,
  });
  if (!parsed.success) throw iamAccountDenied();
  return {
    ...parsed.data,
    id: source.id,
    enabled: source.status === RELAY_CHANNEL_STATUS.ENABLED,
    createTime: source.createTime,
    updateTime: source.updateTime,
  };
}
