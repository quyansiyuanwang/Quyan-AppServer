import { Prisma } from "@prisma/client";
import { prisma } from "@/config/database";

type TransactionClient = Omit<
  Prisma.TransactionClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

export class RelayChannelProviderRevenueRepository {
  private static instance: RelayChannelProviderRevenueRepository;

  static getInstance(): RelayChannelProviderRevenueRepository {
    if (!this.instance) this.instance = new RelayChannelProviderRevenueRepository();
    return this.instance;
  }

  async listOwnEarnings(userId: string, skip: number, take: number) {
    const where = { provider: { userId }, status: 1 };
    const [total, records, pending, settled] = await Promise.all([
      prisma.relayChannelProviderEarning.count({ where }),
      prisma.relayChannelProviderEarning.findMany({
        where,
        include: { provider: { include: { relayChannel: { select: { id: true, name: true } } } } },
        orderBy: { createTime: "desc" },
        skip,
        take,
      }),
      prisma.relayChannelProviderEarning.aggregate({
        where: { ...where, settlementId: null },
        _sum: { commissionAmount: true },
      }),
      prisma.relayChannelProviderEarning.aggregate({
        where: { ...where, settlementId: { not: null } },
        _sum: { commissionAmount: true },
      }),
    ]);
    return {
      total,
      records,
      pendingAmount: pending._sum.commissionAmount,
      settledAmount: settled._sum.commissionAmount,
    };
  }

  async listManualProviderIds(userId: string): Promise<Array<{ id: string }>> {
    return prisma.relayChannelProvider.findMany({
      where: { userId, status: 1, settlementMode: "manual" },
      select: { id: true },
    });
  }

  async listDueProviders(now: Date) {
    return prisma.relayChannelProvider.findMany({
      where: { status: 1, settlementMode: { in: ["interval", "daily"] }, nextSettlementAt: { lte: now } },
      select: { id: true, settlementMode: true, settlementIntervalDays: true, settlementTime: true },
    });
  }

  async updateNextSettlementAt(id: string, nextSettlementAt: Date): Promise<void> {
    await prisma.relayChannelProvider.update({ where: { id }, data: { nextSettlementAt } });
  }

  async withSerializableTransaction<T>(callback: (tx: TransactionClient) => Promise<T>): Promise<T> {
    return prisma.$transaction(callback, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}

export type RelayChannelProviderRevenueTransactionClient = TransactionClient;
