import { prisma } from "@/config/database";
import { RELAY_CHANNEL_STATUS, VISIBLE_RELAY_CHANNEL_STATUSES } from "@/constant/relay-channel";
import type { RelayChannel, Prisma } from "@prisma/client";
import type { RelayChannelMemberInput, RelayChannelStore, RelayChannelTransactionClient } from "./relay-channel.store";

const relayChannelInclude = {
  poolMembers: {
    include: { memberChannel: true },
    orderBy: { priority: "asc" },
  },
} satisfies Prisma.RelayChannelInclude;

export class RelayChannelRepository implements RelayChannelStore {
  private static instance: RelayChannelRepository;

  public static getInstance(): RelayChannelRepository {
    if (!RelayChannelRepository.instance) RelayChannelRepository.instance = new RelayChannelRepository();

    return RelayChannelRepository.instance;
  }

  async withTransaction<T>(callback: (tx: RelayChannelTransactionClient) => Promise<T>): Promise<T> {
    return prisma.$transaction((tx) => callback(tx as RelayChannelTransactionClient));
  }

  async findActiveByName(name: string): Promise<RelayChannel | null> {
    return prisma.relayChannel.findFirst({
      where: {
        name,
        status: RELAY_CHANNEL_STATUS.ENABLED,
      },
      include: relayChannelInclude,
    });
  }

  async findVisibleByName(name: string): Promise<RelayChannel | null> {
    return prisma.relayChannel.findFirst({
      where: {
        name,
        status: { in: VISIBLE_RELAY_CHANNEL_STATUSES },
      },
      include: relayChannelInclude,
    });
  }

  async listActive(tx?: RelayChannelTransactionClient): Promise<RelayChannel[]> {
    const client = tx ?? prisma;
    return client.relayChannel.findMany({
      where: { status: RELAY_CHANNEL_STATUS.ENABLED },
      orderBy: { createTime: "desc" },
      include: relayChannelInclude,
    });
  }

  async listVisible(tx?: RelayChannelTransactionClient): Promise<RelayChannel[]> {
    const client = tx ?? prisma;
    return client.relayChannel.findMany({
      where: { status: { in: VISIBLE_RELAY_CHANNEL_STATUSES } },
      orderBy: { createTime: "desc" },
      include: relayChannelInclude,
    });
  }

  async findActiveById(id: string): Promise<RelayChannel | null> {
    return prisma.relayChannel.findFirst({
      where: {
        id,
        status: RELAY_CHANNEL_STATUS.ENABLED,
      },
      include: relayChannelInclude,
    });
  }

  async findVisibleById(id: string): Promise<RelayChannel | null> {
    return prisma.relayChannel.findFirst({
      where: {
        id,
        status: { in: VISIBLE_RELAY_CHANNEL_STATUSES },
      },
      include: relayChannelInclude,
    });
  }

  async listActiveByIds(ids: string[], tx?: RelayChannelTransactionClient): Promise<RelayChannel[]> {
    if (ids.length === 0) return [];

    const client = tx ?? prisma;
    return client.relayChannel.findMany({
      where: {
        id: { in: ids },
        status: RELAY_CHANNEL_STATUS.ENABLED,
      },
      include: relayChannelInclude,
    });
  }

  async listVisibleByIds(ids: string[], tx?: RelayChannelTransactionClient): Promise<RelayChannel[]> {
    if (ids.length === 0) return [];

    const client = tx ?? prisma;
    return client.relayChannel.findMany({
      where: {
        id: { in: ids },
        status: { in: VISIBLE_RELAY_CHANNEL_STATUSES },
      },
      include: relayChannelInclude,
    });
  }

  async create(
    data: Prisma.RelayChannelUncheckedCreateInput,
    tx?: RelayChannelTransactionClient,
  ): Promise<RelayChannel> {
    const client = tx ?? prisma;
    return client.relayChannel.create({
      data,
      include: relayChannelInclude,
    });
  }

  async updateById(
    id: string,
    data: Prisma.RelayChannelUncheckedUpdateInput,
    tx?: RelayChannelTransactionClient,
  ): Promise<RelayChannel> {
    const client = tx ?? prisma;
    return client.relayChannel.update({
      where: { id },
      data,
      include: relayChannelInclude,
    });
  }

  async updateStatusByIds(ids: string[], status: number): Promise<number> {
    if (ids.length === 0) return 0;

    const result = await prisma.relayChannel.updateMany({
      where: {
        id: { in: ids },
        status: { in: VISIBLE_RELAY_CHANNEL_STATUSES },
      },
      data: { status },
    });

    return result.count;
  }

  async countDirectBusinessReferences(id: string): Promise<number> {
    const [primaryTokenCount, channelConfigTokenCount, ojApiKeyCount, monthlyPassTemplates] = await Promise.all([
      prisma.relayToken.count({ where: { channelId: id } }),
      prisma.relayTokenChannelConfig.count({ where: { channelId: id } }),
      prisma.oJAPIKey.count({ where: { channelId: id, status: 1 } }),
      prisma.monthlyPassTemplate.findMany({
        where: { status: { not: -1 }, allowedChannels: { not: null } },
        select: { allowedChannels: true },
      }),
    ]);

    const monthlyPassReferenceCount = monthlyPassTemplates.filter((template) => {
      try {
        const allowedChannels = JSON.parse(template.allowedChannels || "[]");
        return Array.isArray(allowedChannels) && allowedChannels.includes(id);
      } catch {
        return false;
      }
    }).length;

    return primaryTokenCount + channelConfigTokenCount + ojApiKeyCount + monthlyPassReferenceCount;
  }

  async softDeleteAndUnassignTokens(id: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await tx.relayToken.updateMany({
        where: { channelId: id },
        data: { channelId: null },
      });

      await tx.relayToken.updateMany({
        where: { automaticProxyPoolChannelId: id },
        data: { automaticProxyPoolChannelId: null, routingMode: "ordered" },
      });

      await tx.relayTokenChannelConfig.deleteMany({ where: { channelId: id } });

      await tx.relayChannelMember.deleteMany({
        where: { relayChannelId: id },
      });

      await tx.relayChannelMember.deleteMany({
        where: { memberChannelId: id },
      });

      await tx.relayChannel.update({
        where: { id },
        data: { status: RELAY_CHANNEL_STATUS.DELETED },
      });
    });
  }

  async softDeleteAndUnassignTokensByIds(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;

    return prisma.$transaction(async (tx) => {
      await tx.relayToken.updateMany({
        where: { channelId: { in: ids } },
        data: { channelId: null },
      });

      await tx.relayToken.updateMany({
        where: { automaticProxyPoolChannelId: { in: ids } },
        data: { automaticProxyPoolChannelId: null, routingMode: "ordered" },
      });

      await tx.relayTokenChannelConfig.deleteMany({ where: { channelId: { in: ids } } });

      await tx.relayChannelMember.deleteMany({
        where: {
          OR: [{ relayChannelId: { in: ids } }, { memberChannelId: { in: ids } }],
        },
      });

      const result = await tx.relayChannel.updateMany({
        where: {
          id: { in: ids },
          status: { in: VISIBLE_RELAY_CHANNEL_STATUSES },
        },
        data: { status: RELAY_CHANNEL_STATUS.DELETED },
      });

      return result.count;
    });
  }

  async replaceMembersByChannelId(
    relayChannelId: string,
    members: RelayChannelMemberInput[],
    tx?: RelayChannelTransactionClient,
  ): Promise<void> {
    const client = tx ?? prisma;

    await client.relayChannelMember.deleteMany({
      where: { relayChannelId },
    });

    if (members.length === 0) return;

    await client.relayChannelMember.createMany({
      data: members.map((member) => ({
        relayChannelId,
        memberChannelId: member.memberChannelId,
        priority: member.priority,
        weight: member.weight ?? 1,
        enabled: member.enabled ?? true,
      })),
    });
  }

  async deleteMembersByChannelId(relayChannelId: string, tx?: RelayChannelTransactionClient): Promise<void> {
    const client = tx ?? prisma;
    await client.relayChannelMember.deleteMany({
      where: { relayChannelId },
    });
  }
}
