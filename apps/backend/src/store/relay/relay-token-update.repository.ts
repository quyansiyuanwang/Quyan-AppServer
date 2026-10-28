import { Prisma } from "@prisma/client";
import { RelayCompositionRepository } from "./relay-composition.repository";
import { compositionError } from "@/util/relay/relay-composition.util";
import type {
  RelayFailoverConfigInput,
  RelayTokenChannelConfigInput,
  RelayTokenQuotaWindowInput,
  RelayTokenUpdateInput,
} from "./relay-token.store";

export const buildRelayTokenFailoverCreateData = (failoverConfig: RelayFailoverConfigInput) => {
  return {
    enabled: failoverConfig.enabled ?? false,
    maxRetries: failoverConfig.maxRetries ?? 2,
    retryStatusCodes: failoverConfig.retryStatusCodes ?? [],
    failoverThreshold: failoverConfig.failoverThreshold ?? 0,
    failbackCooldownMinutes: failoverConfig.failbackCooldownMinutes ?? 0,
    maxAcceptedChannelMultiplier: failoverConfig.maxAcceptedChannelMultiplier ?? null,
    minCacheHitRate: failoverConfig.minCacheHitRate ?? null,
  } satisfies Prisma.RelayTokenFailoverConfigCreateWithoutRelayTokenInput;
};

const buildRelayTokenFailoverUpdateData = (failoverConfig: RelayFailoverConfigInput) => {
  return {
    enabled: failoverConfig.enabled,
    maxRetries: failoverConfig.maxRetries,
    retryStatusCodes: failoverConfig.retryStatusCodes,
    failoverThreshold: failoverConfig.failoverThreshold,
    failbackCooldownMinutes: failoverConfig.failbackCooldownMinutes,
    maxAcceptedChannelMultiplier: failoverConfig.maxAcceptedChannelMultiplier,
    minCacheHitRate: failoverConfig.minCacheHitRate,
  } satisfies Prisma.RelayTokenFailoverConfigUncheckedUpdateInput;
};

/** Transaction-only writer shared by legacy and native authorization boundaries.
 * Never opens or commits its own transaction and never hydrates credential values.
 * The caller owns identity, resource, quota and response authorization checks.
 */
export class RelayTokenUpdateRepository {
  private static instance: RelayTokenUpdateRepository;
  static getInstance() {
    return (this.instance ??= new RelayTokenUpdateRepository());
  }
  async apply(tx: Prisma.TransactionClient, id: string, data: RelayTokenUpdateInput): Promise<void> {
    const {
      memberTokenConfigs,
      streamConfig,
      failoverConfig,
      channelConfigs,
      quotaWindows,
      channelId,
      modelMapping,
      requestFormatTransforms,
      normalizerConfig,
      contentSafetyConfig,
      automaticProxyPoolChannelId,
      blockedAutomaticProxyPoolChannelIds,
      ...tokenData
    } = data;

    if (data.routingMode !== undefined || memberTokenConfigs !== undefined) {
      const current = await tx.relayToken.findUniqueOrThrow({ where: { id }, select: { userId: true } });
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${current.userId} FOR UPDATE`;
      const node = await tx.relayToken.findUniqueOrThrow({
        where: { id },
        select: { id: true, userId: true, status: true, routingMode: true, memberTokenConfigs: true },
      });
      const mode = data.routingMode ?? node.routingMode;
      if (mode !== "composite" && memberTokenConfigs?.length) throw compositionError("mode");
      if (mode === "composite" && (channelId || channelConfigs?.length || automaticProxyPoolChannelId))
        throw compositionError("mode");
      await RelayCompositionRepository.getInstance().validateWrite(tx, {
        ...node,
        routingMode: mode,
        memberTokenConfigs: mode === "composite" ? (memberTokenConfigs ?? node.memberTokenConfigs) : [],
      });
      if (memberTokenConfigs !== undefined || mode !== "composite") {
        await tx.relayTokenMemberConfig.deleteMany({ where: { parentTokenId: id } });
        if (mode === "composite" && memberTokenConfigs?.length)
          await tx.relayTokenMemberConfig.createMany({
            data: memberTokenConfigs.map((member) => ({ ...member, parentTokenId: id })),
          });
      }
    }
    const updatedToken = await tx.relayToken.update({
      select: { id: true, channelId: true },
      where: { id },
      data: {
        ...tokenData,
        ...(streamConfig !== undefined
          ? { streamConfig: streamConfig === null ? Prisma.DbNull : (streamConfig as Prisma.InputJsonValue) }
          : {}),
        ...(channelId !== undefined ? { channelId } : {}),
        ...(automaticProxyPoolChannelId !== undefined ? { automaticProxyPoolChannelId } : {}),
        ...(blockedAutomaticProxyPoolChannelIds !== undefined ? { blockedAutomaticProxyPoolChannelIds } : {}),
        ...(modelMapping !== undefined ? { modelMapping: modelMapping as Prisma.InputJsonValue } : {}),
        ...(requestFormatTransforms !== undefined
          ? {
              requestFormatTransforms:
                requestFormatTransforms === null
                  ? Prisma.DbNull
                  : (requestFormatTransforms as unknown as Prisma.InputJsonValue),
            }
          : {}),
        ...(normalizerConfig !== undefined
          ? {
              normalizerConfig:
                normalizerConfig === null ? Prisma.DbNull : (normalizerConfig as unknown as Prisma.InputJsonValue),
            }
          : {}),
        ...(contentSafetyConfig !== undefined
          ? {
              contentSafetyConfig:
                contentSafetyConfig === null
                  ? Prisma.DbNull
                  : (contentSafetyConfig as unknown as Prisma.InputJsonValue),
            }
          : {}),
      },
    });

    if (failoverConfig) await this.failover(tx, id, failoverConfig);

    if (channelConfigs) await this.channels(tx, id, channelId ?? updatedToken.channelId, channelConfigs);

    if (quotaWindows !== undefined) await this.quotaWindows(tx, id, quotaWindows);
  }
  failover(tx: Prisma.TransactionClient, relayTokenId: string, failoverConfig: RelayFailoverConfigInput) {
    return tx.relayTokenFailoverConfig.upsert({
      where: { relayTokenId },
      create: { relayTokenId, ...buildRelayTokenFailoverCreateData(failoverConfig) },
      update: buildRelayTokenFailoverUpdateData(failoverConfig),
    });
  }
  async channels(
    tx: Prisma.TransactionClient,
    relayTokenId: string,
    channelId: string | null,
    configs: RelayTokenChannelConfigInput[],
  ): Promise<void> {
    await tx.relayToken.update({ where: { id: relayTokenId }, data: { channelId }, select: { id: true } });
    await tx.relayTokenChannelConfig.deleteMany({ where: { relayTokenId } });
    if (configs.length === 0) return;
    await tx.relayTokenChannelConfig.createMany({
      data: configs.map((config) => ({
        relayTokenId,
        channelId: config.channelId,
        priority: config.priority,
      })),
    });
  }

  async quotaWindows(
    tx: Prisma.TransactionClient,
    relayTokenId: string,
    quotaWindows: RelayTokenQuotaWindowInput[],
  ): Promise<void> {
    await tx.relayTokenQuotaWindow.deleteMany({
      where: { relayTokenId },
    });

    if (quotaWindows.length === 0) return;

    await tx.relayTokenQuotaWindow.createMany({
      data: quotaWindows.map((quotaWindow) => ({
        relayTokenId,
        quotaLimit: quotaWindow.quotaLimit,
        quotaUnit: quotaWindow.quotaUnit,
        quotaWindowHours: quotaWindow.quotaWindowHours,
      })),
    });
  }
}
