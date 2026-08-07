import { Decimal } from "@prisma/client/runtime/library";
import { DistributedLockService } from "@/services/infrastructure/distributed-lock.service";
import { ConflictError, NotFoundError } from "@/util/errors";
import {
  RelayChannelProviderRevenueRepository,
  type RelayChannelProviderRevenueTransactionClient,
} from "@/store/relay/relay-channel-provider-revenue.repository";

const round4 = (value: number) => Math.round(value * 10000) / 10000;

type TransactionClient = RelayChannelProviderRevenueTransactionClient;

export class RelayChannelProviderRevenueService {
  private static instance: RelayChannelProviderRevenueService;

  private constructor(
    private readonly lockService = DistributedLockService.getInstance(),
    private readonly revenueRepository = RelayChannelProviderRevenueRepository.getInstance(),
  ) {}

  static getInstance(): RelayChannelProviderRevenueService {
    if (!this.instance) this.instance = new RelayChannelProviderRevenueService();
    return this.instance;
  }

  async recordChargedUsage(
    tx: TransactionClient,
    input: { relayUsageId: string; relayChannelId: string; grossAmount: number },
  ): Promise<void> {
    if (input.grossAmount <= 0) return;
    const providers = await tx.relayChannelProvider.findMany({
      where: { relayChannelId: input.relayChannelId, status: 1 },
    });

    const earningRows = providers
      .map((provider) => ({
        provider,
        commissionAmount: round4((input.grossAmount * Number(provider.commissionPercent)) / 100),
      }))
      .filter(({ commissionAmount }) => commissionAmount > 0);
    if (!earningRows.length) return;

    await tx.relayChannelProviderEarning.createMany({
      data: earningRows.map(({ provider, commissionAmount }) => ({
        providerId: provider.id,
        relayUsageId: input.relayUsageId,
        grossAmount: new Decimal(input.grossAmount),
        commissionPercent: provider.commissionPercent,
        commissionAmount: new Decimal(commissionAmount),
      })),
      skipDuplicates: true,
    });

    const realtimeProviderIds = earningRows
      .filter(({ provider }) => provider.settlementMode === "realtime")
      .map(({ provider }) => provider.id);
    if (!realtimeProviderIds.length) return;
    const realtimeEarnings = await tx.relayChannelProviderEarning.findMany({
      where: {
        relayUsageId: input.relayUsageId,
        providerId: { in: realtimeProviderIds },
        settlementId: null,
        status: 1,
      },
      select: { id: true, providerId: true },
    });
    for (const earning of realtimeEarnings)
      await this.settleEarningsInTransaction(tx, earning.providerId, [earning.id], "realtime");
  }

  async listOwnEarnings(userId: string, page = 1, pageSize = 20) {
    const normalizedPage = Math.max(1, Math.floor(page));
    const normalizedPageSize = Math.min(100, Math.max(1, Math.floor(pageSize)));
    const { total, records, pendingAmount, settledAmount } = await this.revenueRepository.listOwnEarnings(
      userId,
      (normalizedPage - 1) * normalizedPageSize,
      normalizedPageSize,
    );
    return {
      total,
      page: normalizedPage,
      pageSize: normalizedPageSize,
      pendingAmount: Number(pendingAmount || 0),
      settledAmount: Number(settledAmount || 0),
      records: records.map((earning) => ({
        id: earning.id,
        channelId: earning.provider.relayChannel.id,
        channelName: earning.provider.relayChannel.name,
        grossAmount: Number(earning.grossAmount),
        commissionPercent: Number(earning.commissionPercent),
        commissionAmount: Number(earning.commissionAmount),
        settled: Boolean(earning.settlementId),
        createTime: earning.createTime,
        settledAt: earning.settledAt || undefined,
      })),
    };
  }

  async claimOwnEarnings(userId: string): Promise<{ settledAmount: number; settlementId?: string }> {
    const providers = await this.revenueRepository.listManualProviderIds(userId);
    let settledAmount = 0;
    let settlementId: string | undefined;
    for (const provider of providers) {
      const settlement = await this.settleProvider(provider.id, "manual");
      if (!settlement) continue;
      settledAmount = round4(settledAmount + settlement.amount);
      settlementId = settlement.id;
    }
    return { settledAmount, settlementId };
  }

  async runScheduledSettlements(now = new Date()): Promise<void> {
    await this.lockService.runWithLock(
      DistributedLockService.buildKey("billing", "relay-channel-provider-settlement"),
      async () => {
        const providers = await this.revenueRepository.listDueProviders(now);
        for (const provider of providers) {
          await this.settleProvider(provider.id, provider.settlementMode);
          const nextSettlementAt = this.nextSettlementAt(provider, now);
          await this.revenueRepository.updateNextSettlementAt(provider.id, nextSettlementAt);
        }
      },
      { ttlMs: 55_000, acquireTimeoutMs: 0, failClosed: false },
    );
  }

  private nextSettlementAt(
    provider: { settlementMode: string; settlementIntervalDays: number | null; settlementTime: string | null },
    now: Date,
  ): Date {
    if (provider.settlementMode === "interval")
      return new Date(now.getTime() + Math.max(1, provider.settlementIntervalDays || 1) * 24 * 60 * 60 * 1000);
    const [hours, minutes] = (provider.settlementTime || "00:00").split(":").map(Number);
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(now)
      .reduce<Record<string, number>>((result, part) => {
        if (part.type === "year" || part.type === "month" || part.type === "day")
          result[part.type] = Number(part.value);
        return result;
      }, {});
    let targetPseudoUtc = Date.UTC(parts.year, parts.month - 1, parts.day, hours || 0, minutes || 0);
    const targetUtc = new Date(targetPseudoUtc - 8 * 60 * 60 * 1000);
    if (targetUtc <= now) {
      targetPseudoUtc += 24 * 60 * 60 * 1000;
    }
    return new Date(targetPseudoUtc - 8 * 60 * 60 * 1000);
  }

  private async settleProvider(providerId: string, mode: string): Promise<{ id: string; amount: number } | null> {
    return this.revenueRepository.withSerializableTransaction(async (tx) => {
      const provider = await tx.relayChannelProvider.findUnique({ where: { id: providerId } });
      if (!provider || provider.status !== 1) return null;
      const earnings = await tx.relayChannelProviderEarning.findMany({
        where: { providerId, settlementId: null, status: 1 },
        select: { id: true, commissionAmount: true },
      });
      if (!earnings.length) return null;
      return this.settleEarningsInTransaction(
        tx,
        providerId,
        earnings.map((earning) => earning.id),
        mode,
      );
    });
  }

  private async settleEarningsInTransaction(
    tx: TransactionClient,
    providerId: string,
    earningIds: string[],
    mode: string,
  ): Promise<{ id: string; amount: number }> {
    const provider = await tx.relayChannelProvider.findUnique({ where: { id: providerId } });
    if (!provider) throw new NotFoundError("Relay channel provider not found");
    const earnings = await tx.relayChannelProviderEarning.findMany({
      where: { id: { in: earningIds }, providerId, settlementId: null, status: 1 },
      select: { id: true, commissionAmount: true },
    });
    if (!earnings.length) throw new ConflictError("Channel revenue has already been settled");
    const amount = round4(earnings.reduce((sum, earning) => sum + Number(earning.commissionAmount), 0));
    const account = await tx.balanceAccount.findUnique({ where: { userId: provider.userId } });
    const balanceBefore = Number(account?.balance || 0);
    const balanceAfter = round4(balanceBefore + amount);
    if (account)
      await tx.balanceAccount.update({
        where: { userId: provider.userId },
        data: { balance: new Decimal(balanceAfter), totalCommissionEarned: { increment: new Decimal(amount) } },
      });
    else
      await tx.balanceAccount.create({
        data: {
          userId: provider.userId,
          balance: new Decimal(balanceAfter),
          totalCommissionEarned: new Decimal(amount),
        },
      });
    const settlement = await tx.relayChannelProviderSettlement.create({
      data: { providerId, amount: new Decimal(amount), settlementMode: mode },
    });
    const balanceTransaction = await tx.balanceTransaction.create({
      data: {
        userId: provider.userId,
        type: "channel_commission",
        amount: new Decimal(amount),
        balanceBefore: new Decimal(balanceBefore),
        balanceAfter: new Decimal(balanceAfter),
        relatedId: settlement.id,
        description: "渠道提供分成结算",
      },
    });
    await tx.relayChannelProviderSettlement.update({
      where: { id: settlement.id },
      data: { balanceTransactionId: balanceTransaction.id },
    });
    const updated = await tx.relayChannelProviderEarning.updateMany({
      where: { id: { in: earnings.map((earning) => earning.id) }, settlementId: null },
      data: { settlementId: settlement.id, settledAt: new Date() },
    });
    if (updated.count !== earnings.length) throw new ConflictError("Channel revenue settlement changed concurrently");
    await tx.relayChannelProvider.update({ where: { id: providerId }, data: { lastSettledAt: new Date() } });
    return { id: settlement.id, amount };
  }
}
