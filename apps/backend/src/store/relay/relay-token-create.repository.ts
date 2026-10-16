import { Prisma } from "@prisma/client";
import { RelayCompositionRepository } from "./relay-composition.repository";
import { buildRelayTokenFailoverCreateData } from "./relay-token-update.repository";
import { compositionError } from "@/util/relay/relay-composition.util";
import type {
  RelayTokenCreateInput,
  RelayTokenChannelConfigInput,
  RelayTokenQuotaWindowInput,
  RelayTokenTransactionClient,
} from "./relay-token.store";

const buildChannelConfigCreateManyData = (configs: RelayTokenChannelConfigInput[]) =>
  configs.map((config) => ({
    channelId: config.channelId,
    priority: config.priority,
  }));

const buildQuotaWindowCreateManyData = (quotaWindows: RelayTokenQuotaWindowInput[]) =>
  quotaWindows.map((quotaWindow) => ({
    quotaLimit: quotaWindow.quotaLimit,
    quotaUnit: quotaWindow.quotaUnit,
    quotaWindowHours: quotaWindow.quotaWindowHours,
  }));

/** Transaction-only persistence, not an authorization boundary. Callers own admission and final response checks. */
export class RelayTokenCreateRepository {
  private static instance: RelayTokenCreateRepository;
  static getInstance(): RelayTokenCreateRepository {
    return (this.instance ??= new RelayTokenCreateRepository());
  }

  /** Persist only; return the resource ID without hydrating credentials, principals or upstream relations. */
  async apply(tx: RelayTokenTransactionClient, data: RelayTokenCreateInput, reservedId?: string): Promise<string> {
    if (data.routingMode === "composite") {
      if (data.channelId || data.channelConfigs?.length || data.automaticProxyPoolChannelId)
        throw compositionError("mode");
      await RelayCompositionRepository.getInstance().validateWrite(tx, {
        id: reservedId ?? "__new_composition__",
        userId: data.userId,
        routingMode: "composite",
        status: data.status ?? 1,
        memberTokenConfigs: data.memberTokenConfigs ?? [],
      });
    } else if (data.memberTokenConfigs?.length) throw compositionError("mode");
    const failoverConfigCreateData = data.failoverConfig
      ? buildRelayTokenFailoverCreateData(data.failoverConfig)
      : undefined;

    const created = await tx.relayToken.create({
      data: {
        ...(reservedId === undefined ? {} : { id: reservedId }),
        userId: data.userId,
        status: data.status,
        name: data.name,
        token: data.token,
        legacyToken: data.legacyToken,
        isCustomKey: data.isCustomKey ?? false,
        expiresAt: data.expiresAt,
        channelId: data.channelId,
        routingMode: data.routingMode ?? "ordered",
        automaticProxyPoolChannelId: data.automaticProxyPoolChannelId,
        blockedAutomaticProxyPoolChannelIds: data.blockedAutomaticProxyPoolChannelIds,
        quotaLimit: data.quotaLimit,
        allowedModels: data.allowedModels,
        requestFormatTransforms: data.requestFormatTransforms as Prisma.InputJsonValue | undefined,
        normalizerConfig: data.normalizerConfig as Prisma.InputJsonValue | undefined,
        streamConfig: data.streamConfig as Prisma.InputJsonValue | undefined,
        memberTokenConfigs:
          data.routingMode === "composite" ? { createMany: { data: data.memberTokenConfigs ?? [] } } : undefined,
        contentSafetyConfig: data.contentSafetyConfig as Prisma.InputJsonValue | undefined,
        ipWhitelist: data.ipWhitelist,
        modelMapping: data.modelMapping ?? undefined,
        failoverConfig: failoverConfigCreateData
          ? {
              create: failoverConfigCreateData,
            }
          : undefined,
        channelConfigs:
          data.channelConfigs && data.channelConfigs.length > 0
            ? {
                createMany: {
                  data: buildChannelConfigCreateManyData(data.channelConfigs),
                },
              }
            : undefined,
        quotaWindows:
          data.quotaWindows && data.quotaWindows.length > 0
            ? {
                createMany: {
                  data: buildQuotaWindowCreateManyData(data.quotaWindows),
                },
              }
            : undefined,
      },
      select: { id: true },
    });
    return created.id;
  }
}
