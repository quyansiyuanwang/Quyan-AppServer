import { prisma } from "@/config/database";
import { RELAY_CHANNEL_STATUS, VISIBLE_RELAY_CHANNEL_STATUSES } from "@/constant/relay-channel";
import type { RelayChannel, Prisma } from "@prisma/client";
import type { RelayChannelStore, RelayChannelTransactionClient } from "./relay-channel.store";

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
    });
  }

  async findVisibleByName(name: string): Promise<RelayChannel | null> {
    return prisma.relayChannel.findFirst({
      where: {
        name,
        status: { in: VISIBLE_RELAY_CHANNEL_STATUSES },
      },
    });
  }

  async listActive(): Promise<RelayChannel[]> {
    return prisma.relayChannel.findMany({
      where: { status: RELAY_CHANNEL_STATUS.ENABLED },
      orderBy: { createTime: "desc" },
    });
  }

  async listVisible(): Promise<RelayChannel[]> {
    return prisma.relayChannel.findMany({
      where: { status: { in: VISIBLE_RELAY_CHANNEL_STATUSES } },
      orderBy: { createTime: "desc" },
    });
  }

  async findActiveById(id: string): Promise<RelayChannel | null> {
    return prisma.relayChannel.findFirst({
      where: {
        id,
        status: RELAY_CHANNEL_STATUS.ENABLED,
      },
    });
  }

  async findVisibleById(id: string): Promise<RelayChannel | null> {
    return prisma.relayChannel.findFirst({
      where: {
        id,
        status: { in: VISIBLE_RELAY_CHANNEL_STATUSES },
      },
    });
  }

  async listActiveByIds(ids: string[]): Promise<RelayChannel[]> {
    if (ids.length === 0) return [];

    return prisma.relayChannel.findMany({
      where: {
        id: { in: ids },
        status: RELAY_CHANNEL_STATUS.ENABLED,
      },
    });
  }

  async listVisibleByIds(ids: string[]): Promise<RelayChannel[]> {
    if (ids.length === 0) return [];

    return prisma.relayChannel.findMany({
      where: {
        id: { in: ids },
        status: { in: VISIBLE_RELAY_CHANNEL_STATUSES },
      },
    });
  }

  async create(
    data: Prisma.RelayChannelUncheckedCreateInput,
    tx?: RelayChannelTransactionClient,
  ): Promise<RelayChannel> {
    const client = tx ?? prisma;
    return client.relayChannel.create({ data });
  }

  async updateById(id: string, data: Prisma.RelayChannelUncheckedUpdateInput): Promise<RelayChannel> {
    return prisma.relayChannel.update({
      where: { id },
      data,
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

  async softDeleteAndUnassignTokens(id: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await tx.relayToken.updateMany({
        where: { channelId: id },
        data: { channelId: null },
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

      await tx.relayTokenChannelConfig.deleteMany({
        where: { channelId: { in: ids } },
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
}
